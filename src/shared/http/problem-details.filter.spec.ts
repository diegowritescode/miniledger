import { type ArgumentsHost, HttpException } from '@nestjs/common';
import { ProblemException } from './problem-details';
import { ProblemDetailsFilter } from './problem-details.filter';

interface RecordingResponse {
  statusCode: number;
  contentType: string;
  body: unknown;
  status(code: number): RecordingResponse;
  type(value: string): RecordingResponse;
  send(payload: unknown): RecordingResponse;
}

const buildResponse = (): RecordingResponse => {
  const response: RecordingResponse = {
    statusCode: 0,
    contentType: '',
    body: undefined,
    status(code) {
      response.statusCode = code;
      return response;
    },
    type(value) {
      response.contentType = value;
      return response;
    },
    send(payload) {
      response.body = payload;
      return response;
    },
  };
  return response;
};

const hostFor = (response: RecordingResponse): ArgumentsHost =>
  ({
    switchToHttp: () => ({ getResponse: () => response }),
  }) as unknown as ArgumentsHost;

describe('ProblemDetailsFilter', () => {
  const filter = new ProblemDetailsFilter();

  it('renders a structured problem as application/problem+json', () => {
    const response = buildResponse();
    const exception = new ProblemException({
      type: 'https://miniledger.dev/problems/example',
      title: 'Example',
      status: 422,
      detail: 'Nope',
    });

    filter.catch(exception, hostFor(response));

    expect(response.statusCode).toBe(422);
    expect(response.contentType).toBe('application/problem+json');
    expect(response.body).toEqual({
      type: 'https://miniledger.dev/problems/example',
      title: 'Example',
      status: 422,
      detail: 'Nope',
    });
  });

  it('falls back to about:blank for plain HTTP exceptions', () => {
    const response = buildResponse();

    filter.catch(new HttpException('Not found', 404), hostFor(response));

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ type: 'about:blank', title: 'Not found', status: 404 });
  });
});
