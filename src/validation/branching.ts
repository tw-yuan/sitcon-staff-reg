import { Field } from '../models/fields';
import { Section } from '../models/sections';

/**
 * 依「提交的答案」從第一個區塊開始重算應經過的區塊（伺服器權威，不信任前端）。
 *
 * 規則：每個區塊若有「分段題」（第一個設了 optionJumps 的單選題），依該題答案跳段：
 *   - 答案對應到某區塊 id → 前往該區塊
 *   - 答案對應到 'submit' → 結束（送出）
 *   - 否則 → 依順序前往下一個區塊
 * 以 seen 避免無限迴圈。
 */
export function computeVisitedSections(
  sections: Section[],
  fields: Field[],
  rawAnswer: (key: string) => string,
): number[] {
  if (!sections.length) return [];
  const ordered = [...sections].sort((a, b) => a.position - b.position || a.id - b.id);
  const byId = new Map(ordered.map((s) => [s.id, s]));

  const visited: number[] = [];
  const seen = new Set<number>();
  let current: Section | undefined = ordered[0];

  while (current && !seen.has(current.id)) {
    visited.push(current.id);
    seen.add(current.id);

    const brancher = fields.find(
      (f) =>
        f.sectionId === current!.id &&
        f.type === 'single_select' &&
        Object.keys(f.optionJumps).length > 0,
    );

    let next: number | 'submit' | null = null;
    if (brancher) {
      const jump = brancher.optionJumps[rawAnswer(brancher.key)];
      if (jump === 'submit') next = 'submit';
      else if (jump && byId.has(Number(jump))) next = Number(jump);
    }

    if (next === 'submit') break;
    if (next === null) {
      const idx = ordered.findIndex((s) => s.id === current!.id);
      current = ordered[idx + 1];
    } else {
      current = byId.get(next);
    }
  }
  return visited;
}
