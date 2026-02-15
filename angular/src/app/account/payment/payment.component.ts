import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import Big from 'big.js';
import { Subscription } from 'rxjs';
import { Account } from 'src/shared';
import { Network } from 'src/shared/networks';
import { PaymentRequest } from 'src/shared/payment';
import { NetworksService, SendService, UIState, WalletManager } from '../../services';

@Component({
  selector: 'app-payment',
  templateUrl: './payment.component.html',
  styleUrls: ['./payment.component.css'],
})
export class PaymentComponent implements OnInit, OnDestroy {
  network: Network;
  subscriptions: Subscription[] = [];
  filteredAccounts: Account[];
  amount: Big;

  constructor(
    private paymentRequest: PaymentRequest,
    private walletManager: WalletManager,
    public sendService: SendService,
    private router: Router,
    public uiState: UIState,
    public networkService: NetworksService,
    public translate: TranslateService
  ) {}

  ngOnDestroy() {
    this.subscriptions.forEach((sub) => {
      sub.unsubscribe();
    });

    this.subscriptions = [];
  }

  ngOnInit() {
    if (this.uiState.isPaymentAction) {
      this.uiState.showBackButton = false;
    } else {
      this.uiState.showBackButton = true;
      this.uiState.goBackHome = true;
    }

    this.network = this.networkService.getNetworkBySymbol(this.uiState.payment.network);
    this.amount = this.paymentRequest.parseAmount(this.uiState.payment.options.amount);

    var accounts = this.walletManager.activeWallet.accounts;
    this.filteredAccounts = accounts.filter((a) => a.networkType == this.network.id);
  }

  cancel(close: boolean) {
    this.uiState.payment = null;

    if (close) {
      window.close();
    } else {
      this.router.navigateByUrl('/dashboard');
    }
  }

  async sendToUsing(address: string, accountId: string) {
    await this.walletManager.setActiveAccount(accountId);
    this.sendService.sendToAddress = address;
    this.sendService.sendAmount = this.uiState.payment.options.amount;
    this.sendService.payment = this.uiState.payment;

    this.router.navigate(['/', 'account', 'send']);
  }
}
