import { deepStrictEqual, strictEqual } from 'assert';
import { should } from 'micro-should';
import { NoblePoseidonMina } from '../esm/mina.js';

// Compare results of noble curves implementation of Mina spec Poseidon hash and update with the results of the o1js implementation

should('minaPoseidon.hash(0)', () => {
  const hash = NoblePoseidonMina.hash([
    0x0000000000000000000000000000000000000000000000000000000000000000n,
  ]);

  strictEqual(hash, 21565680844461314807147611702860246336805372493508489110556896454939225549736n);
});

should('minaPoseidon.hash(|x|=rate)', () => {
  const hash = NoblePoseidonMina.hash([0x123456789n, 0x987654321n]);

  strictEqual(hash, 6449939084237974168090090163969627591733334698545722094862854383080361015108n);
});

should('minaPoseidon.hash(|x|>|state|)', () => {
  const hash = NoblePoseidonMina.hash([0x123456789n, 0x987654321n, 0x111111111n, 0x222222222n]);

  strictEqual(hash, 7086421824999214816040993327443118080799261539573279816489315488843338970939n);
});

should('minaPoseidon.update()', () => {
  const hash = NoblePoseidonMina.update(
    [0x0n, 0x0n, 0x0n],
    [0x123456789n, 0x987654321n, 0x111111111n, 0x222222222n]
  );

  deepStrictEqual(hash, [
    7086421824999214816040993327443118080799261539573279816489315488843338970939n,
    24255828122293124723017996660138530458492366535185820084523109857456014350584n,
    17342126924487604719448776942466490569395676744372320506499808444160008658554n,
  ]);
});

// ESM is broken.
import url from 'url';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  should.run();
}
