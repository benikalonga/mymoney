/** Pure pricing maths. All amounts are integers in minor units (cents). */

export interface FeeRule {
  percentBps: number;
  flatUsd: number;
}

export interface PriceInput {
  sendAmount?: number;
  receiveAmount?: number;
  /** Units of each currency per one US dollar. */
  sendPerUsd: number;
  receivePerUsd: number;
  /** Margin taken on the exchange rate. Ignored when both currencies are the same. */
  spreadBps: number;
  fee: FeeRule;
  sameCurrency: boolean;
}

export interface Price {
  sendAmount: number;
  receiveAmount: number;
  fee: number;
  rate: number;
  total: number;
}

export function customerRate(sendPerUsd: number, receivePerUsd: number, spreadBps: number, sameCurrency: boolean) {
  if (sameCurrency) return 1;
  return (receivePerUsd / sendPerUsd) * (1 - spreadBps / 10_000);
}

export function toUsd(amount: number, perUsd: number) {
  return Math.round(amount / perUsd);
}

export function computeFee(sendAmount: number, sendPerUsd: number, rule: FeeRule) {
  const percent = Math.ceil((sendAmount * rule.percentBps) / 10_000);
  const flat = Math.ceil(rule.flatUsd * sendPerUsd);
  return percent + flat;
}

export function price(input: PriceInput): Price {
  const rate = customerRate(input.sendPerUsd, input.receivePerUsd, input.spreadBps, input.sameCurrency);
  let sendAmount: number;
  let receiveAmount: number;
  if (input.sendAmount !== undefined) {
    sendAmount = input.sendAmount;
    receiveAmount = input.sameCurrency ? sendAmount : Math.floor(sendAmount * rate);
  } else if (input.receiveAmount !== undefined) {
    receiveAmount = input.receiveAmount;
    sendAmount = input.sameCurrency ? receiveAmount : Math.ceil(receiveAmount / rate);
  } else {
    throw new Error('Either sendAmount or receiveAmount is required');
  }
  const fee = computeFee(sendAmount, input.sendPerUsd, input.fee);
  return { sendAmount, receiveAmount, fee, rate, total: sendAmount + fee };
}
