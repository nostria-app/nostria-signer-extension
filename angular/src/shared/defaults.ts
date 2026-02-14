import { Account } from './interfaces';
import { BITCOIN_TESTNET, BTC, CITY, IDENTITY, NOSTR, KEY } from './networks';
import { JWK } from './networks/JWK';
const { v4: uuidv4 } = require('uuid');

export class Defaults {
  static getNetworks() {
    const networks = [];
    networks.push(new BTC());
    networks.push(new CITY());
    networks.push(new IDENTITY());
    networks.push(new JWK());
    networks.push(new KEY());
    networks.push(new NOSTR());
    networks.push(new BITCOIN_TESTNET());
    return networks;
  }

  static getDefaultAccounts(_instance: string) {
    const accounts: Account[] = [
      {
        identifier: uuidv4(),
        index: 0,
        networkType: 'NOSTR',
        selected: true,
        mode: 'normal',
        name: 'Nostr Key',
        type: 'identity',
        network: 1237,
        purpose: 44,
        purposeAddress: 340,
        icon: 'account_circle',
      }
    ];

    return accounts;
  }
}
