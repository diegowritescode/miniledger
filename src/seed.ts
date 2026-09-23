import './load-env-file';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AccountsService } from './ledger/application/accounts.service';
import { ReverseService } from './ledger/application/reverse.service';
import { TransferService, type TransferInput } from './ledger/application/transfer.service';
import { type Account } from './ledger/domain/account';

interface Movement {
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly currency: string;
  readonly key: string;
}

async function main(): Promise<void> {
  const owner = process.env.DEMO_OWNER_SUBJECT;
  if (!owner) {
    throw new Error('DEMO_OWNER_SUBJECT (the AccessCore demo user id) is required');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const accounts = app.get(AccountsService);
    const transfers = app.get(TransferService);
    const reversals = app.get(ReverseService);

    const visible = await accounts.listVisible(owner);
    if (visible.some((account) => !account.isSystem())) {
      process.stdout.write(`Seed already applied for ${owner}\n`);
      return;
    }

    const world = (currency: string): Account => {
      const account = visible.find((a) => a.isSystem() && a.currency.code === currency);
      if (!account) throw new Error(`missing @world account for ${currency}`);
      return account;
    };
    const open = async (currency: string): Promise<Account> => {
      const opened = await accounts.open({ currency, ownerId: owner });
      if (!opened.ok) throw new Error(`failed to open ${currency} account: ${opened.error}`);
      return opened.value;
    };

    const checking = await open('USD');
    const savings = await open('USD');
    const travel = await open('EUR');
    const usdWorld = world('USD').id.value;
    const eurWorld = world('EUR').id.value;

    const post = async (movement: Movement): Promise<string> => {
      const input: TransferInput = {
        from: movement.from,
        to: movement.to,
        amount: movement.amount,
        currency: movement.currency,
        ownerId: owner,
        idempotencyKey: `seed-${movement.key}`,
      };
      const result = await transfers.transfer(input);
      if (!result.ok) throw new Error(`seed movement ${movement.key} failed: ${result.error}`);
      return result.value.id;
    };

    const movements: Movement[] = [
      { key: 'payroll', from: usdWorld, to: checking.id.value, amount: '420000', currency: 'USD' },
      {
        key: 'save-1',
        from: checking.id.value,
        to: savings.id.value,
        amount: '75000',
        currency: 'USD',
      },
      { key: 'rent', from: checking.id.value, to: usdWorld, amount: '145000', currency: 'USD' },
      { key: 'groceries', from: checking.id.value, to: usdWorld, amount: '8645', currency: 'USD' },
      {
        key: 'save-2',
        from: checking.id.value,
        to: savings.id.value,
        amount: '50000',
        currency: 'USD',
      },
      { key: 'fx-top-up', from: eurWorld, to: travel.id.value, amount: '180000', currency: 'EUR' },
      { key: 'hotel', from: travel.id.value, to: eurWorld, amount: '42990', currency: 'EUR' },
    ];
    const posted = new Map<string, string>();
    for (const movement of movements) {
      posted.set(movement.key, await post(movement));
    }

    const duplicateCharge = await post({
      key: 'duplicate-groceries',
      from: checking.id.value,
      to: usdWorld,
      amount: '8645',
      currency: 'USD',
    });
    const reversed = await reversals.reverse(duplicateCharge);
    if (!reversed.ok) throw new Error(`seed reversal failed: ${reversed.error}`);

    process.stdout.write(
      [
        'Seed applied.',
        `  owner:    ${owner}`,
        `  accounts: USD ${checking.id.value}, USD ${savings.id.value}, EUR ${travel.id.value}`,
        `  history:  ${posted.size + 1} transfers and 1 reversal (a duplicate charge undone)`,
        '',
      ].join('\n'),
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
