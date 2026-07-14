import { ProblemException } from './problem-details';

describe('ProblemException', () => {
  it('carries the problem payload and HTTP status', () => {
    const problem = {
      type: 'https://miniledger.dev/problems/example',
      title: 'Example',
      status: 422,
      detail: 'Something went wrong',
    };

    const exception = new ProblemException(problem);

    expect(exception.getStatus()).toBe(422);
    expect(exception.getResponse()).toEqual(problem);
  });
});
