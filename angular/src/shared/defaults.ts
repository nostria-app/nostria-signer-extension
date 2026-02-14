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
        networkType: 'BTC',
        mode: 'normal',
        selected: false,
        name: 'Bitcoin',
        type: 'coin',
        network: 0,
        purpose: 44,
        purposeAddress: 44,
        icon: 'paid',
      },
      {
        identifier: uuidv4(),
        index: 0,
        networkType: 'CITY',
        mode: 'normal',
        selected: false,
        name: 'City Coin',
        type: 'coin',
        network: 1926,
        purpose: 44,
        purposeAddress: 44,
        icon: 'paid',
      },
      {
        identifier: uuidv4(),
        index: 0,
        networkType: 'IDENTITY',
        selected: false,
        mode: 'normal',
        name: 'Identity',
        type: 'identity',
        network: 616,
        purpose: 302,
        purposeAddress: 340, // BIP0340
        icon: 'account_circle',
      },
      {
        identifier: uuidv4(),
        index: 0,
        networkType: 'NOSTR',
        selected: false,
        mode: 'normal',
        name: 'Nostr',
        type: 'identity',
        network: 1237,
        purpose: 44,
        purposeAddress: 340,
        icon: 'account_circle',
      },
      {
        identifier: uuidv4(),
        index: 0,
        networkType: 'BITCOIN_TESTNET',
        mode: 'normal',
        selected: false,
        name: 'Bitcoin Testnet',
        type: 'coin',
        network: 1,
        purpose: 44,
        purposeAddress: 44,
        icon: 'paid',
      }
    ];

    return accounts;
  }
}
