// The ABI box stores dollars to the cent: whole dollars would make 1 ABI of a
// $0.25 ticket $0. The stored dollars are off by at most half a cent, which
// moves the count read back by under 0.5 for any ABI above one cent, so a whole
// count survives the round trip.
export function bankrollFromAbiCount(count: number, abi: number): number {
  return abi > 0 ? Math.round(count * abi * 100) / 100 : 0;
}

export function abiCountFromBankroll(bankroll: number, abi: number): number {
  return abi > 0 ? Math.round(bankroll / abi) : 0;
}
