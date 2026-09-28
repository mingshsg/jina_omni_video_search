/**
 * Split bilingual directors markdown into ZH-only and EN-only bodies.
 * Expects labeled sections like **SLUGLINE (ZH):** / **DIALOGUE (EN):** …
 */

function sceneBlocks(doc: string): string[] {
  const parts = doc.split(/(?=^## SCENE\s+)/m);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function splitOneScene(block: string): { zh: string; en: string } {
  const lines = block.split(/\r?\n/);
  const header = lines[0] ?? '';
  const zh: string[] = [header, ''];
  const en: string[] = [header, ''];
  let mode: 'both' | 'zh' | 'en' | 'skip' = 'both';

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const s = line.trim();

    if (/^\*\*SLUGLINE \(ZH\):\*\*/i.test(s)) {
      zh.push(line.replace(/\*\*SLUGLINE \(ZH\):\*\*/i, '**SLUGLINE:**'));
      mode = 'zh';
      continue;
    }
    if (/^\*\*SLUGLINE \(EN\):\*\*/i.test(s)) {
      en.push(line.replace(/\*\*SLUGLINE \(EN\):\*\*/i, '**SLUGLINE:**'));
      mode = 'en';
      continue;
    }

    if (/^\*\*ACTIVITY \(ZH\):\*\*/i.test(s)) {
      zh.push(line.replace(/\(ZH\)/i, ''));
      mode = 'zh';
      continue;
    }
    if (/^\*\*ACTIVITY \(EN\):\*\*/i.test(s)) {
      en.push(line.replace(/\(EN\)/i, ''));
      mode = 'en';
      continue;
    }

    if (/^\*\*DIALOGUE \(ZH\):\*\*/i.test(s)) {
      zh.push('**DIALOGUE**');
      mode = 'zh';
      continue;
    }
    if (/^\*\*DIALOGUE \(EN\):\*\*/i.test(s)) {
      en.push('**DIALOGUE**');
      mode = 'en';
      continue;
    }

    if (/^\*\*DIR\.? NOTES \(ZH\):\*\*/i.test(s)) {
      zh.push('**DIR. NOTES**');
      mode = 'zh';
      continue;
    }
    if (/^\*\*DIR\.? NOTES \(EN\):\*\*/i.test(s)) {
      en.push('**DIR. NOTES**');
      mode = 'en';
      continue;
    }

    if (/^\*\*EFFECTS.*\(ZH\):\*\*/i.test(s)) {
      zh.push('**EFFECTS / SFX / MUSIC**');
      mode = 'zh';
      continue;
    }
    if (/^\*\*EFFECTS.*\(EN\):\*\*/i.test(s)) {
      en.push('**EFFECTS / SFX / MUSIC**');
      mode = 'en';
      continue;
    }

    if (/^- \*\*ZH:\*\*/i.test(s)) {
      zh.push(`- ${s.replace(/^- \*\*ZH:\*\*\s*/i, '')}`);
      continue;
    }
    if (/^- \*\*EN:\*\*/i.test(s)) {
      en.push(`- ${s.replace(/^- \*\*EN:\*\*\s*/i, '')}`);
      continue;
    }

    if (s.startsWith('**VISUAL') || s.startsWith('**EFFECTS')) {
      zh.push(line);
      en.push(line);
      mode = 'both';
      continue;
    }

    if (s.startsWith('**')) {
      mode = 'both';
      zh.push(line);
      en.push(line);
      continue;
    }

    if (mode === 'zh') zh.push(line);
    else if (mode === 'en') en.push(line);
    else if (mode === 'both') {
      zh.push(line);
      en.push(line);
    }
  }

  return {
    zh: zh.join('\n').trim() + '\n',
    en: en.join('\n').trim() + '\n',
  };
}

export function renumberScenes(body: string): { body: string; count: number } {
  let n = 0;
  const body2 = body.replace(
    /^## SCENE\s+[\d.]+\s*·\s*(.+)$/gm,
    (_m, rest: string) => {
      n += 1;
      return `## SCENE ${n} · ${rest}`;
    },
  );
  return { body: body2, count: n };
}

export function splitBilingualDirectorsDoc(doc: string): {
  zh: string;
  en: string;
} {
  const blocks = sceneBlocks(doc);
  if (blocks.length === 0) {
    return { zh: doc, en: doc };
  }
  const zhParts: string[] = [];
  const enParts: string[] = [];
  for (const b of blocks) {
    if (!/^## SCENE/m.test(b)) {
      zhParts.push(b);
      enParts.push(b);
      continue;
    }
    const split = splitOneScene(b);
    zhParts.push(split.zh);
    enParts.push(split.en);
  }
  return {
    zh: zhParts.join('\n\n').trim() + '\n',
    en: enParts.join('\n\n').trim() + '\n',
  };
}
