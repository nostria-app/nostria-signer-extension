import { Component, OnInit, OnDestroy } from '@angular/core';
import { UIState } from '../../services';
import { ActionService } from 'src/app/services/action.service';
import { CommunicationService } from 'src/app/services/communication.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-wallet.unlock',
  templateUrl: './wallet.unlock.component.html',
  styleUrls: ['./wallet.unlock.component.css'],
})
export class ActionWalletUnlockComponent implements OnInit, OnDestroy {
  content: string;

  constructor(
    public uiState: UIState,
    public actionService: ActionService,
    private communication: CommunicationService,
    private router: Router
  ) {
    this.actionService.consentType = 'regular';
  }

  ngOnDestroy(): void {}

  ngOnInit(): void {
    // Wallet has been unlocked. In the side panel, navigate back to the dashboard
    // instead of closing the window.
    if (this.communication.isSidePanel) {
      this.router.navigateByUrl('/dashboard');
    } else {
      window.close();
    }
  }
}
