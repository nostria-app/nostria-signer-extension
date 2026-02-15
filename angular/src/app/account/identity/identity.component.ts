import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AccountStateStore } from 'src/shared';
import { CryptoUtility, UIState, WalletManager } from 'src/app/services';
import { copyToClipboard } from 'src/app/shared/utilities';
import { IdentityService } from 'src/app/services/identity.service';
import { TranslateService } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { PasswordDialog } from 'src/app/shared/password-dialog/password-dialog';
import * as QRCode from 'qrcode';
import { SigningUtilities } from 'src/shared/identity/signing-utilities';

@Component({
  selector: 'app-identity',
  templateUrl: './identity.component.html',
  styleUrls: ['./identity.component.css'],
})
export class IdentityComponent implements OnInit, OnDestroy {
  identifier: string;
  privateKey = '';
  verifiedWalletPassword?: boolean;
  qrCodePublicKey: string;
  qrCodePrivateKey: string;
  cryptoUtility: CryptoUtility;
  conversionKey: string;
  convertedKey: string;
  invalidConversion: boolean;
  showConversionOptions = false;
  conversionKeyType = 'npub';
  utility = new SigningUtilities();

  constructor(
    public uiState: UIState,
    public walletManager: WalletManager,
    private snackBar: MatSnackBar,
    private activatedRoute: ActivatedRoute,
    private accountStateStore: AccountStateStore,
    private identityService: IdentityService,
    public translate: TranslateService,
    public dialog: MatDialog
  ) {
    this.uiState.showBackButton = true;

    this.cryptoUtility = new CryptoUtility();

    this.activatedRoute.paramMap.subscribe(async (params) => {
      const accountIdentifier: any = params.get('index');

      if (!this.walletManager.activeWallet) {
        return;
      }

      await this.walletManager.setActiveAccount(accountIdentifier);

      const activeAccount = this.walletManager.activeAccount;

      if (!activeAccount) {
        return;
      }

      this.uiState.title = activeAccount.name;

      const accountState = this.accountStateStore.get(activeAccount.identifier);

      // The very first receive address is the actual identity of the account.
      const address = accountState?.receive?.[0];

      const identityNode = this.identityService.getIdentityNode(this.walletManager.activeWallet, activeAccount);

      if (address?.address) {
        this.identifier = this.utility.getNostrIdentifier(address.address);
      } else {
        this.identifier = this.cryptoUtility.convertToBech32(identityNode.publicKey, 'npub');
      }

      this.qrCodePublicKey = await QRCode.toDataURL(this.identifier, {
        errorCorrectionLevel: 'L',
        margin: 2,
        scale: 5,
      });
    });
  }

  convertKey() {
    this.invalidConversion = false;

    if (!this.conversionKey) {
      this.convertedKey = null;
      this.showConversionOptions = false;
      return;
    }

    try {
      if (this.conversionKey.startsWith('npub') || this.conversionKey.startsWith('nsec')) {
        this.showConversionOptions = false;
        this.convertedKey = this.cryptoUtility.arrayToHex(this.cryptoUtility.convertFromBech32(this.conversionKey));
      } else {
        this.showConversionOptions = true;
        const key = this.cryptoUtility.hexToArray(this.conversionKey);
        this.convertedKey = this.cryptoUtility.convertToBech32(key, this.conversionKeyType);
      }
    } catch (err) {
      this.invalidConversion = true;
      this.convertedKey = null;
      this.showConversionOptions = false;
    }
  }

  resetPrivateKey() {
    this.privateKey = null;
    this.qrCodePrivateKey = null;
    this.verifiedWalletPassword = null;
  }

  async exportPrivateKey() {
    this.verifiedWalletPassword = null;
    this.privateKey = null;
    const dialogRef = this.dialog.open(PasswordDialog, {
      data: { password: null },
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result === null || result === undefined || result === '') {
        return;
      }

      this.verifiedWalletPassword = await this.walletManager.verifyWalletPassword(this.walletManager.activeWalletId, result);

      if (this.verifiedWalletPassword === true) {
        const identityNode = this.identityService.getIdentityNode(this.walletManager.activeWallet, this.walletManager.activeAccount);

        this.privateKey = this.cryptoUtility.convertToBech32(identityNode.privateKey, 'nsec');
        // console.log(secp.utils.bytesToHex(identityNode.privateKey));
        //this.privateKey = secp.utils.bytesToHex(identityNode.privateKey);

        this.qrCodePrivateKey = await QRCode.toDataURL(this.privateKey, {
          errorCorrectionLevel: 'L',
          margin: 2,
          scale: 5,
        });
      }
    });
  }

  async copyPrivateKey() {
    copyToClipboard(this.privateKey);

    this.snackBar.open(await this.translate.get('Account.PrivateKeyCopiedToClipboard').toPromise(), await this.translate.get('Account.PrivateKeyCopiedToClipboardAction').toPromise(), {
      duration: 2500,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  async copy() {
    copyToClipboard(this.identifier);

    this.snackBar.open(await this.translate.get('Account.IdentifierCopiedToClipboard').toPromise(), await this.translate.get('Account.IdentifierCopiedToClipboardAction').toPromise(), {
      duration: 2500,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  async copyConvertedKey() {
    copyToClipboard(this.convertedKey);

    this.snackBar.open(await this.translate.get('Account.IdentifierCopiedToClipboard').toPromise(), await this.translate.get('Account.IdentifierCopiedToClipboardAction').toPromise(), {
      duration: 2500,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  ngOnDestroy(): void {}

  async ngOnInit(): Promise<void> {
    return;
  }
}
