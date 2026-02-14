import { Location } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { UIState, FeatureService, LoggingMonitor, LoggerService } from '../../services';

@Component({
  selector: 'app-debugger',
  templateUrl: './debugger.component.html',
  styleUrls: ['./debugger.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class DebuggerComponent implements OnDestroy, OnInit {
  updating = false;
  level: any;

  constructor(
    public logMonitor: LoggingMonitor,
    public uiState: UIState,
    public location: Location,
    public feature: FeatureService,
    public translate: TranslateService,
    private logger: LoggerService
  ) {
    this.uiState.title = 'Logs';
    this.uiState.showBackButton = true;
    this.uiState.goBackHome = false;
  }

  async ngOnInit() {
    this.uiState.title = await this.translate.get('Settings.Logs').toPromise();
    this.level = this.logger.currentLevel();
  }

  ngOnDestroy() {}

  cancel() {
    this.location.back();
  }

  async reset() {
    if (this.level < 2) {
      this.logger.disableDebug();
    } else {
      this.logger.enableDebug();
    }
    this. level = this.logger.currentLevel();
  }
}
