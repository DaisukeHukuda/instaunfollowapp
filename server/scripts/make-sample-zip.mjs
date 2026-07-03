// 動作確認用のサンプルエクスポートZIPを data/sample-export.zip に生成する
// 実行: node server/scripts/make-sample-zip.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const igEntry = (username, daysAgo) => ({
  title: '',
  media_list_data: [],
  string_list_data: [
    {
      href: `https://www.instagram.com/${username}`,
      value: username,
      timestamp: Math.floor(Date.now() / 1000) - daysAgo * 86400,
    },
  ],
});

const followers = [
  igEntry('yamada_taro', 900),
  igEntry('cafe_nikko', 400),
  igEntry('sup_lover_22', 120),
  igEntry('fan_account_x', 30),
];
const following = [
  igEntry('yamada_taro', 850),
  igEntry('cafe_nikko', 380),
  igEntry('old_shop_2019', 2400),
  igEntry('influencer_aaa', 1100),
  igEntry('travel_gram_jp', 60),
];

const zip = zipSync({
  'connections/followers_and_following/followers_1.json': strToU8(JSON.stringify(followers)),
  'connections/followers_and_following/following.json': strToU8(
    JSON.stringify({ relationships_following: following }),
  ),
});

const out = join(root, 'data', 'sample-export.zip');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, zip);
console.log(`sample zip written: ${out}`);
