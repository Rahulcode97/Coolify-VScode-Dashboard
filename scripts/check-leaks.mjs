#!/usr/bin/env node
// Fails if any file (or the packaged .vsix) contains a name, host, id or address
// from the private setup this extension grew out of. The list is stored only as
// SHA-256 hashes, so publishing this script does not publish the list.
//
//   node scripts/check-leaks.mjs              # scan files tracked or staged in git
//   node scripts/check-leaks.mjs --vsix x.vsix  # also scan a packaged extension
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BLOCKED = new Set(["02ab2a0d7ff1845f5a6243bf1eef65dfefbc0ac83a81fb4e5510c2e42ae9c022", "0b2e70cf7a2ffc0413efd91cb4383917d3319c6d3f7c3501833af084be8ffec2", "0bafde133e02104f9bf71ec97b64114b4ba76f96bcee19b85d793927275659d2", "0f04ffdde0a565d435f97f61b2fd55b4af9c2bf0f23d3e289be2cb3947d317e3", "1c9cd0faef87308a2d12e0478942e82279ce39bc40a36e3833e76b3995b180e5", "1ea68f8eb3f34e11fca0636b8693bb6de0e17bba58df830c216e2b8b439847f5", "2003f97dee44c9684e0d23235777525df84a10ddd504618caaf184ef157f8a42", "259436397bbae853494898d0f013ae90d094368b6b01f413e1657269c7efd186", "31f8e919bdc6f24397acf141575b4e546afd3abc271c6e3eb7526c3d852459f4", "46522d62c217ec1b2186e3fb4f41ad3b638a42a754b8137a703ea127e427c619", "4888233a566d5c3d6a0b477d53e07bf70d2dc002427c1645da5b0ecfd7aff358", "5079ae6d4524f247bd03e8fb24ec90733cd7b517e482a391bf406dce946d9830", "535d2f128f9b97212272d2548a922e173ffebd48fbb8033f2305c9fb9b1cb968", "55a9b4ea1c30a5be7702f684c94bd610678a8e45479e038944929ee297e25452", "5fb1fca2a1e634c15f6bbff1067487f6dda8fd5bcecdf18385614531f3b54178", "63af163c50543fbbb62820d663321a797590614f35ee2338983c62d20c2f9c4e", "7593192bd51e1afd943d95348b0a3b67c8cf555f95c161743c32527f7f1d36c0", "80377a4be6805b10f8762756948345142f62a2fb906f8acdb0d6f14fc71d3564", "851ec13bc5c7b209e7e68fc1b140a221b52c8618b21a4129572ceafaeeb8fb53", "88492b5316c342e327f1c314cbfbe90c91ca0eaead5519fa0c75e63e7ce6a535", "9bcb360d2f015fbeaacee18aa818b947974909f4d0087cc80e6b964bdecf5c0b", "9dedca5be137c7767e754ba2d1b611490335a4aea2996f602b058487ddf7d70a", "a7d1fa5d0b90cb69cd3d1244b416d812533dc3585e3e2cbe3d77cc46ad17f9f2", "adc572c29ffffacd9dec67a8fd8686755a4d56c4bcd1851c45e0662fe08d18dd", "b2839cbb4f37a059985675c689232c5a693c2580f050fb86ef9bc197ad174afc", "ba58d614e7925500db95306fe9753e9125ef9e4da177463802beb9311e38ee8d", "c7a0cb61aaa3fc7b688874440759fbb84f0b87417579fc4f6d723792aed6e297", "ce66899268c4b2815ecb740dd51ab9c966bd966090fea0fdc0635ca767deac3a", "d1828f2fe066e5b867dae90eb89626b504d8b17ade7156e81542b9faaa958158", "d31db7b8feee77969c6c4fe5c3db9bf1cb8760327a683968b85062b1d0b26143", "dab17557fd58145079dbc19d411074edbd29792a7ab7c258a11211d0ecc1e4c3", "dd4ce393517a32cf8eb1f2858fbb54438e4864a69e388cd36087fb18fab87e85", "de13faf69c0d528a5a0643122ea169b8d1397431e0680e573ee8abd2d42840db", "e4051a865729777240684c5a6af37ca4b2929adc1253e8be05e7ed935f1a8014", "ebe67d3d26ee30aa8e759d327fcc48d7d4f0d720d1c7d406e79aeebf68edf475", "fefaa42da40ecf93662a6f2852c1d4315ff7593420cd3538f6eaf6afee38f1a2"]);

const sha = (s) => createHash('sha256').update(s).digest('hex');
const SEP = /[\s._@/:\\,|"'`()[\]{}<>=;-]+/g;

/** Every run of 1–4 consecutive words, with the original separators kept. */
export function findLeaks(text) {
    const lower = text.toLowerCase();
    const atoms = [];
    let last = 0;
    for (const m of lower.matchAll(SEP)) {
        if (m.index > last) atoms.push([last, m.index]);
        last = m.index + m[0].length;
    }
    if (last < lower.length) atoms.push([last, lower.length]);
    const hits = [];
    for (let i = 0; i < atoms.length; i++) {
        for (let j = i; j < Math.min(atoms.length, i + 4); j++) {
            const s = lower.slice(atoms[i][0], atoms[j][1]);
            if (BLOCKED.has(sha(s))) hits.push({ offset: atoms[i][0], length: s.length });
        }
    }
    return hits;
}

function lineOf(text, offset) {
    return text.slice(0, offset).split('\n').length;
}

function scan(files, label) {
    let bad = 0;
    for (const f of files) {
        let text;
        try {
            text = readFileSync(f, 'latin1');
        } catch {
            continue;
        }
        for (const h of findLeaks(text)) {
            bad++;
            // Never print the matched text itself.
            console.error(`  ✗ ${label(f)}:${lineOf(text, h.offset)}  (blocked term, ${h.length} chars)`);
        }
    }
    return bad;
}

function walk(dir) {
    return readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

const root = process.cwd();
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((f) => join(root, f));
let bad = scan(files, (f) => f.slice(root.length + 1));

const vsixIdx = process.argv.indexOf('--vsix');
if (vsixIdx > 0) {
    const vsix = process.argv[vsixIdx + 1];
    const dir = mkdtempSync(join(tmpdir(), 'vsix-'));
    execFileSync('unzip', ['-q', '-o', vsix, '-d', dir]);
    bad += scan(walk(dir), (f) => 'vsix:' + f.slice(dir.length + 1));
    console.log(`Scanned ${files.length} repo files and the contents of ${vsix}.`);
} else {
    console.log(`Scanned ${files.length} repo files.`);
}

if (bad) {
    console.error(`\nFound ${bad} blocked term(s). Replace them with neutral examples (example.com, 203.0.113.10, acme-web …).`);
    process.exit(1);
}
console.log('No blocked terms found.');
