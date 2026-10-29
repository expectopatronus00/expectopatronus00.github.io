#!/usr/bin/env node
/**
 * topic-mine.cjs · 选题挖掘
 * -----------------------------------------
 * 把抖音收藏 / 小红书探索流聚合成主题簇，按「跨平台共振 + 命中量 + 偏好权重」
 * 排序，产出 .tools/radar/topics-<日期>.md，供选题与写作使用。
 *
 * 用法：
 *   node scripts/topic-mine.cjs                 # 用 .tools/radar 下最新一次采集
 *   node scripts/topic-mine.cjs --days 3        # 只用近 N 天的采集文件
 *
 * 设计要点：
 * - 不做语义聚类（本地没有 embedding），用「关键词规则首中」的显式规则表，
 *   与 preferences.md 的主题优先级一一对应，规则可读可改。
 * - 同一实体在不同平台各出现一次，计为「共振」，权重 ×1.5——这是最可靠的
 *   选题信号（搬运号会跟风，但两个平台的算法同时推同一个东西，说明它真的在扩散）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RADAR = path.join(ROOT, '.tools', 'radar');

const argv = process.argv.slice(2);
const daysArg = argv.indexOf('--days');
const DAYS = daysArg >= 0 ? Number(argv[daysArg + 1]) || 7 : 7;

/* ─────────── 主题规则表（顺序即优先级，首中即归类） ─────────── */
/* weight 对照 skills/source-radar/preferences.md 的主题优先级：
   ★★★ = 1.0，★★☆ = 0.75，★☆☆ = 0.5，☆ = 0.25 */
const TOPICS = [
  {
    id: 'model-access',
    name: '模型接入 / 免费通道',
    weight: 0.9,
    re: /免费模型|白嫖|免费.*(token|额度|api)|接入|中转|token|apikey|api ?key|deepseek|claude|gpt|gemini|qwen|kimi|豆包/i,
  },
  {
    id: 'skill-eco',
    name: 'Agent Skill 生态',
    weight: 1.0,
    re: /skill|技能包|技能库|claude\.md|agents\.md/i,
  },
  {
    id: 'ai-coding',
    name: 'AI 编程工作流',
    weight: 1.0,
    re: /claude ?code|codex|cursor|vibe ?coding|vibecoding|编程|写代码|代码审查|重构|agent ?设计|智能体/i,
  },
  {
    id: 'opensource',
    name: '开源项目 / GitHub',
    weight: 1.0,
    re: /github|开源|star|仓库|热榜|open ?source/i,
  },
  {
    id: 'quant',
    name: '量化 / 看盘',
    weight: 0.75,
    re: /量化|股市|a股|看盘|板块|选股|持仓|行情|交易/i,
  },
  {
    id: 'infra',
    name: '本地部署 / 硬件',
    weight: 0.75,
    re: /显卡|gpu|显存|本地部署|部署|服务器|算力|4090|5080|nas|模型量化/i,
  },
  {
    id: 'bigtech',
    name: '大厂官方动作',
    weight: 0.75,
    re: /anthropic|openai|google|微软|腾讯|阿里|字节|官方(发布|开源|上线)|发布会/i,
  },
  {
    id: 'content',
    name: '内容生产 / 自媒体',
    weight: 0.5,
    re: /自媒体|公众号|小红书|抖音运营|涨粉|选题|口播|剪辑|封面|文案/i,
  },
  {
    id: 'growth',
    name: '效率与成长',
    weight: 0.5,
    re: /效率|工作流|副业|面试|简历|转行|学习方法|时间管理/i,
  },
];

const NOISE = /漫剧|短剧|游戏|三角洲|美食|旅游|减肥|护肤|情感|星座|招聘|考公|考研|装修|育儿/i;

/* ─────────── 读取采集文件 ─────────── */

function loadLatest() {
  if (!fs.existsSync(RADAR)) return [];
  const cutoff = Date.now() - DAYS * 864e5;
  const files = fs
    .readdirSync(RADAR)
    .filter(f => /^(douyin-fav|scan|fav-delta|feed)-.*\.json$/.test(f))
    .map(f => {
      const p = path.join(RADAR, f);
      return { p, f, mtime: fs.statSync(p).mtimeMs };
    })
    .filter(x => x.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime);

  const items = [];
  for (const { p, f } of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      continue;
    }
    const platform = f.startsWith('douyin') ? '抖音' : f.startsWith('scan') ? '小红书' : '其他';
    const list = data.items || data.xhs || data.douyin || (Array.isArray(data) ? data : []);
    for (const it of list) {
      const title = String(it.title || it.key || '').replace(/\s+/g, ' ').trim();
      if (title.length < 6) continue;
      items.push({ title, platform, href: it.href || '', file: f });
    }
  }
  return items;
}

/* ─────────── 归类 ─────────── */

function classify(title) {
  if (NOISE.test(title)) return null;
  for (const t of TOPICS) if (t.re.test(title)) return t;
  return null;
}

function shortTitle(t, n) {
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/* ─────────── 主流程 ─────────── */

const all = loadLatest();
const buckets = new Map();

for (const it of all) {
  const topic = classify(it.title);
  if (!topic) continue;
  if (!buckets.has(topic.id)) buckets.set(topic.id, { topic, items: [], platforms: new Set() });
  const b = buckets.get(topic.id);
  b.items.push(it);
  b.platforms.add(it.platform);
}

const rows = [...buckets.values()].map(b => {
  const resonance = b.platforms.size >= 2;
  const score = b.items.length * b.topic.weight * (resonance ? 1.5 : 1);
  return { ...b, resonance, score };
});

rows.sort((a, b) => b.score - a.score);

/* ─────────── 输出 ─────────── */

const today = new Date().toISOString().slice(0, 10);
const out = path.join(RADAR, 'topics-' + today + '.md');
const L = [];

L.push('# 选题池 · ' + today);
L.push('');
L.push('> 由 `scripts/topic-mine.cjs` 从抖音收藏 / 小红书探索流聚合而成。');
L.push('> 打分 = 命中条数 × 主题权重 × 跨平台共振系数（双平台命中 ×1.5）。');
L.push('> 分数只代表「这个方向在扩散」，**不代表选题成立**——能否成文取决于');
L.push('> 有没有可核对的原始实体（仓库 / 官网 / 论文）。');
L.push('');
L.push('采集条数：' + all.length + '｜归入主题：' + rows.reduce((s, r) => s + r.items.length, 0) + '｜主题簇：' + rows.length);
L.push('');

rows.forEach((r, i) => {
  const tag = r.resonance ? ' 🔥 双平台共振' : '';
  L.push('## ' + (i + 1) + '. ' + r.topic.name + '（' + r.score.toFixed(1) + ' 分）' + tag);
  L.push('');
  L.push('- 命中：' + r.items.length + ' 条｜平台：' + [...r.platforms].join('、') + '｜权重：' + r.topic.weight);
  L.push('- 样本：');
  const seen = new Set();
  let n = 0;
  for (const it of r.items) {
    const key = shortTitle(it.title, 18);
    if (seen.has(key)) continue;
    seen.add(key);
    L.push('  - [' + it.platform + '] ' + shortTitle(it.title, 60));
    if (++n >= 6) break;
  }
  L.push('');
});

L.push('---');
L.push('');
L.push('## 怎么用这份清单');
L.push('');
L.push('1. 从共振簇里挑一条，先找原始实体（GitHub 仓库 / 官网 / 论文），核对存在性。');
L.push('2. 找不到实体的，只能写「现象观察」，不能当「工具推荐」发——按 preferences.md 的硬条件直接丢弃。');
L.push('3. 与 `home/articles.js` 现有 122 篇标题比对，撞车的换角度或放弃。');
L.push('4. 写作时按站内既有结构：事件是什么 → 怎么用 → 边界与冷思考。');

fs.writeFileSync(out, L.join('\n'), 'utf8');

console.log('采集条数:', all.length);
console.log('主题簇:', rows.length);
console.log('');
rows.slice(0, 8).forEach((r, i) => {
  console.log(
    String(i + 1).padStart(2) + '. ' + r.topic.name.padEnd(18) +
    ' ' + String(r.items.length).padStart(4) + ' 条  ' +
    r.score.toFixed(1).padStart(6) + ' 分  ' +
    (r.resonance ? '🔥双平台' : '')
  );
});
console.log('\n落盘:', out);
