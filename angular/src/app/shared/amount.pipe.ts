import { Pipe, PipeTransform } from '@angular/core';
import Big from 'big.js';

@Pipe({ name: 'amount', pure: false })
export class AmountPipe implements PipeTransform {
  transform(value: number | Big, decimals = 8, useFormat = true): string {
    if (!useFormat) {
      return value.toString();
    }

    const factor = Number('1' + ''.padStart(decimals, '0'));

    if (value instanceof Big) {
      return value.div(factor).toFixed(decimals);
    }

    return (value / factor).toFixed(decimals);
  }
}
