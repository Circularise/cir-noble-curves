/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
// Poseidon Hash: https://eprint.iacr.org/2019/458.pdf, https://www.poseidon-hash.info
import { IField, FpPow, validateField } from './modular.js';
// We don't provide any constants, since different implementations use different constants.
// For reference constants see './test/poseidon.test.js'.
export type PoseidonOpts = {
  Fp: IField<bigint>;
  t: number;
  roundsFull: number;
  roundsPartial: number;
  sboxPower?: number;
  reversePartialPowIdx?: boolean; // Hack for stark
  mds: bigint[][];
  roundConstants: bigint[][];
};

export function validateOpts(opts: PoseidonOpts) {
  const { Fp, mds, reversePartialPowIdx: rev, roundConstants: rc } = opts;
  const { roundsFull, roundsPartial, sboxPower, t } = opts;

  validateField(Fp);
  for (const i of ['t', 'roundsFull', 'roundsPartial'] as const) {
    if (typeof opts[i] !== 'number' || !Number.isSafeInteger(opts[i]))
      throw new Error(`Poseidon: invalid param ${i}=${opts[i]} (${typeof opts[i]})`);
  }

  // MDS is TxT matrix
  if (!Array.isArray(mds) || mds.length !== t) throw new Error('Poseidon: wrong MDS matrix');
  const _mds = mds.map((mdsRow) => {
    if (!Array.isArray(mdsRow) || mdsRow.length !== t)
      throw new Error(`Poseidon MDS matrix row: ${mdsRow}`);
    return mdsRow.map((i) => {
      if (typeof i !== 'bigint') throw new Error(`Poseidon MDS matrix value=${i}`);
      return Fp.create(i);
    });
  });

  if (rev !== undefined && typeof rev !== 'boolean')
    throw new Error(`Poseidon: invalid param reversePartialPowIdx=${rev}`);

  // if (roundsFull % 2 !== 0) throw new Error(`Poseidon roundsFull is not even: ${roundsFull}`);
  const rounds = roundsFull + roundsPartial;

  if (!Array.isArray(rc) || rc.length !== rounds)
    throw new Error('Poseidon: wrong round constants');
  const roundConstants = rc.map((rc) => {
    if (!Array.isArray(rc) || rc.length !== t)
      throw new Error(`Poseidon wrong round constants: ${rc}`);
    return rc.map((i) => {
      if (typeof i !== 'bigint' || !Fp.isValid(i))
        throw new Error(`Poseidon wrong round constant=${i}`);
      return Fp.create(i);
    });
  });

  if (!sboxPower || ![3, 5, 7].includes(sboxPower))
    throw new Error(`Poseidon wrong sboxPower=${sboxPower}`);
  const _sboxPower = BigInt(sboxPower);
  let sboxFn = (n: bigint) => FpPow(Fp, n, _sboxPower);
  // Unwrapped sbox power for common cases (195->142μs)
  if (sboxPower === 3) sboxFn = (n: bigint) => Fp.mul(Fp.sqrN(n), n);
  else if (sboxPower === 5) sboxFn = (n: bigint) => Fp.mul(Fp.sqrN(Fp.sqrN(n)), n);

  return Object.freeze({ ...opts, rounds, sboxFn, roundConstants, mds: _mds });
}

export function splitConstants(rc: bigint[], t: number) {
  if (typeof t !== 'number') throw new Error('poseidonSplitConstants: wrong t');
  if (!Array.isArray(rc) || rc.length % t) throw new Error('poseidonSplitConstants: wrong rc');
  const res = [];
  let tmp = [];
  for (let i = 0; i < rc.length; i++) {
    tmp.push(rc[i]);
    if (tmp.length === t) {
      res.push(tmp);
      tmp = [];
    }
  }
  return res;
}

export function poseidon(opts: PoseidonOpts) {
  const _opts = validateOpts(opts);
  // const { Fp, mds, roundConstants, rounds, roundsPartial, sboxFn, t } = _opts;
  const { Fp, mds, roundConstants, rounds, sboxFn, t } = _opts;
  // const halfRoundsFull = _opts.roundsFull / 2;
  const partialIdx = _opts.reversePartialPowIdx ? t - 1 : 0;
  // const poseidonRound = (values: bigint[], isFull: boolean, idx: number) => {
  //   values = values.map((i, j) => Fp.add(i, roundConstants[idx][j]));

  //   if (isFull) values = values.map((i) => sboxFn(i));
  //   else values[partialIdx] = sboxFn(values[partialIdx]);
  //   // Matrix multiplication
  //   values = mds.map((i) => i.reduce((acc, i, j) => Fp.add(acc, Fp.mulN(i, values[j])), Fp.ZERO));
  //   return values;
  // };
  const poseidonRound = (values: bigint[], isFull: boolean, idx: number) => {
    if (isFull) values = values.map((i) => sboxFn(i));
    else values[partialIdx] = sboxFn(values[partialIdx]);

    // Matrix multiplication
    values = mds.map((i) => i.reduce((acc, i, j) => Fp.add(acc, Fp.mulN(i, values[j])), Fp.ZERO));

    values = values.map((i, j) => Fp.add(i, roundConstants[idx][j]));

    return values;
  };

  const poseidonHash = function poseidonHash(values: bigint[]): bigint {
    let initialState = Array(t).fill(0n);
    return poseidonUpdate(initialState, values)[0];
  };

  const poseidonUpdate = function poseidonUpdate(state: bigint[], values: bigint[]): bigint[] {
    // if (!Array.isArray(values) || values.length !== t)
    //   throw new Error(`Poseidon: wrong values (expected array of bigints with length ${t})`);
    if (!Array.isArray(values))
      throw new Error(`Poseidon: wrong values (expected array of bigints with length ${t})`);

    // pad input with zeros so its length is a multiple of the rate
    let rate = 2; // hard coded rate
    let n = Math.ceil(values.length / rate) * rate;
    values = values.concat(Array(n - values.length).fill(0n));

    values = values.map((i) => {
      if (typeof i !== 'bigint') throw new Error(`Poseidon: wrong value=${i} (${typeof i})`);
      return Fp.create(i);
    });

    // for every block of length `rate`, add block to the first `rate` elements of the state, and apply the permutation
    for (let blockIndex = 0; blockIndex < n; blockIndex += rate) {
      for (let i = 0; i < rate; i++) {
        state[i] = Fp.add(state[i], values[blockIndex + i]);
      }
      // permutate
      let round = 0;

      // Apply all full rounds
      for (let i = 0; i < rounds; i++) state = poseidonRound(state, true, round++);

      if (round !== rounds)
        throw new Error(`Poseidon: wrong number of rounds: last round=${round}, total=${rounds}`);
    }

    // let round = 0;
    // Apply r_f/2 full rounds.
    // for (let i = 0; i < halfRoundsFull; i++) values = poseidonRound(values, true, round++);
    // // Apply r_p partial rounds.
    // for (let i = 0; i < roundsPartial; i++) values = poseidonRound(values, false, round++);
    // // Apply r_f/2 full rounds.
    // for (let i = 0; i < halfRoundsFull; i++) values = poseidonRound(values, true, round++);

    // if (round !== rounds)
    //   throw new Error(`Poseidon: wrong number of rounds: last round=${round}, total=${rounds}`);
    return state;
  };
  // For verification in tests
  poseidonHash.roundConstants = roundConstants;
  // return poseidonHash;
  return {
    hash: poseidonHash,
    update: poseidonUpdate,
  };
}
