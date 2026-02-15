import { BackgroundManager } from '../background-manager';
import { ActionHandler, ActionState } from './action-handler';
import { ActionPrepareResult, ActionResponse, Permission } from '../interfaces';
import * as bitcoinMessage from 'bitcoinjs-message';
import { HDKey } from '@scure/bip32';
import { Network } from '../networks';

export class PaymentSignHandler implements ActionHandler {
  action = ['payment.sign'];

  constructor(private backgroundManager: BackgroundManager) {}

  async signData(network: Network, node: HDKey, content: string): Promise<string> {
    // TODO: Investigate if Paul Miller or someone else implements an message signing library relying on noble packages.
    var signature = bitcoinMessage.sign(content, Buffer.from(node.privateKey), true, network.messagePrefix);
    return signature.toString('base64');
  }

  async prepare(state: ActionState): Promise<ActionPrepareResult> {
    return {
      content: state.message.request.params[0].challenge,
      consent: true,
    };
  }

  async execute(state: ActionState, permission: Permission): Promise<ActionResponse> {
    // Get the private key
    const { network, node } = await this.backgroundManager.getKey(permission.walletId, permission.accountId, permission.keyId);

    if (state.content) {
      const signature = await this.signData(network, node, state.content);

      let returnData: ActionResponse = {
        key: permission.key,
        response: {
          signature,
          content: state.content,
        },
        network: network.id,
      };

      return returnData;
    } else {
      return { key: '', response: null, network: network.id };
    }
  }
}
