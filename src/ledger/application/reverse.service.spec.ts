import { randomUUID } from 'node:crypto';
import { type Currency } from '../../shared/kernel/currency';
import { type Tx, type UnitOfWork } from '../../shared/persistence/unit-of-work';
import { type JournalTransaction } from '../domain/journal-transaction';
import {
  type JournalTransactionsRepository,
  type OriginalTransaction,
} from '../domain/ports/journal-transactions-repository';
import {
  LedgerPoster,
  LedgerPostingFailure,
  type PostOptions,
  type TransferReceipt,
} from './ledger-poster';
import { ReverseService } from './reverse.service';

const passthroughUow: UnitOfWork = {
  withTransaction: (work) => work({ executor: {} }),
};

const receipt: TransferReceipt = { id: 'compensating', currency: 'USD', postings: [] };

type PostArgs = [JournalTransaction, Currency, PostOptions, Tx];

interface Mocks {
  service: ReverseService;
  findById: jest.Mock<Promise<OriginalTransaction | null>, [string, Tx?]>;
  hasReversal: jest.Mock<Promise<boolean>, [string, Tx?]>;
  post: jest.Mock<Promise<TransferReceipt>, PostArgs>;
}

const build = (original: OriginalTransaction | null, alreadyReversed = false): Mocks => {
  const findById = jest
    .fn<Promise<OriginalTransaction | null>, [string, Tx?]>()
    .mockResolvedValue(original);
  const hasReversal = jest.fn<Promise<boolean>, [string, Tx?]>().mockResolvedValue(alreadyReversed);
  const journals = {
    findById,
    hasReversal,
    append: jest.fn(),
  } as unknown as JournalTransactionsRepository;

  const post = jest.fn<Promise<TransferReceipt>, PostArgs>().mockResolvedValue(receipt);
  const poster = { post } as unknown as LedgerPoster;

  return {
    service: new ReverseService(journals, poster, passthroughUow),
    findById,
    hasReversal,
    post,
  };
};

describe('ReverseService', () => {
  const a = randomUUID();
  const b = randomUUID();
  const transactionId = randomUUID();

  const transfer: OriginalTransaction = {
    currency: 'USD',
    postings: [
      { accountId: a, amount: -100n },
      { accountId: b, amount: 100n },
    ],
  };

  it('posts a compensating entry with negated legs, no owner check, and the reverses link', async () => {
    const { service, post } = build(transfer);

    const result = await service.reverse(transactionId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(receipt);
    expect(post).toHaveBeenCalledTimes(1);

    const [journal, currency, options] = post.mock.calls[0]!;
    const legs = new Map(
      journal.postings.map((posting) => [posting.accountId.value, posting.amount.amount]),
    );
    expect(legs.get(a)).toBe(100n);
    expect(legs.get(b)).toBe(-100n);
    expect(currency.code).toBe('USD');
    expect(options).toEqual({
      requireOwner: null,
      eventType: 'transfer.reversed',
      reversesTransactionId: transactionId,
    });
  });

  it('returns unknown_transaction when the original does not exist', async () => {
    const { service, post } = build(null);

    const result = await service.reverse(transactionId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unknown_transaction');
    expect(post).not.toHaveBeenCalled();
  });

  it('returns already_reversed when a reversal already exists (pre-check)', async () => {
    const { service, post } = build(transfer, true);

    const result = await service.reverse(transactionId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('already_reversed');
    expect(post).not.toHaveBeenCalled();
  });

  it('maps the unique-violation on a concurrent second reversal to already_reversed', async () => {
    const { service, post } = build(transfer);
    post.mockRejectedValueOnce({
      code: '23505',
      constraint: 'journal_transactions_reverses_transaction_id_key',
    });

    const result = await service.reverse(transactionId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('already_reversed');
  });

  it('maps a poster insufficient_funds to insufficient_funds', async () => {
    const { service, post } = build(transfer);
    post.mockRejectedValueOnce(new LedgerPostingFailure('insufficient_funds'));

    const result = await service.reverse(transactionId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('insufficient_funds');
  });

  it('rethrows an unexpected posting failure', async () => {
    const { service, post } = build(transfer);
    post.mockRejectedValueOnce(new Error('boom'));

    await expect(service.reverse(transactionId)).rejects.toThrow('boom');
  });
});
