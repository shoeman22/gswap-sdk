import { expect } from 'chai';
import { parseCliArgs } from '../examples/cli/src/parser.js';

describe('CLI command parser', () => {
  it('accepts the documented swap argument order without a wallet positional argument', () => {
    expect(parseCliArgs(['swap', 'GALA', 'GUSDC', '3000', 'exactIn', '1', '0.9'])).to.deep.equal({
      command: 'swap',
      args: ['GALA', 'GUSDC', '3000', 'exactIn', '1', '0.9'],
    });
  });

  it('rejects the removed wallet-and-position command shapes', () => {
    expect(() =>
      parseCliArgs(['swap', 'wallet', 'GALA', 'GUSDC', '3000', 'exactIn', '1', '0.9']),
    ).to.throw('swap expects 5-6 arguments');
    expect(() => parseCliArgs(['getPositionById', 'owner', 'position'])).to.throw(
      'Unknown command',
    );
  });
});
