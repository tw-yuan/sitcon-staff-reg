import { Field, isChoiceType, isDisplayType, isTextType } from '../models/fields';

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>; // field key -> 錯誤訊息
  values: Record<string, unknown>; // 正規化後的非檔案欄位值（「其他」已解析成自填文字）
}

const OTHER = '__other__';

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (v === undefined || v === null || v === '') return [];
  return [String(v)];
}

/**
 * 依 field schema 驗證工人送出的答案。
 * providedFileKeys：本次有上傳檔案的欄位 key（檔案內容由呼叫端另外處理）。
 */
export function validateAnswers(
  fields: Field[],
  body: Record<string, unknown>,
  providedFileKeys: Set<string>,
): ValidationResult {
  const errors: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  for (const f of fields) {
    if (isDisplayType(f.type)) continue; // 文字說明 / 圖片：只顯示，不收答案

    const rawArr = asArray(body[f.key]);
    const otherText = String(body[f.key + '__other'] ?? '').trim();

    if (f.type === 'file') {
      if (f.required && !providedFileKeys.has(f.key)) {
        errors[f.key] = '此欄位必填，請上傳檔案';
      }
      continue;
    }

    if (f.type === 'multi_select') {
      const chosen = rawArr.filter((v) => f.options.includes(v));
      const hasOther = f.allowOther && rawArr.includes(OTHER);
      const selected = [...chosen];
      if (hasOther && otherText) selected.push(otherText);
      if (f.required && selected.length === 0) {
        errors[f.key] = '此欄位必填，請至少選一項';
      } else if (hasOther && !otherText) {
        errors[f.key] = '選了「其他」請填寫內容';
      }
      values[f.key] = selected;
      continue;
    }

    const value = (rawArr[0] ?? '').trim();

    // 單選 / 下拉的「其他」
    if (isChoiceType(f.type) && f.allowOther && value === OTHER) {
      if (otherText === '') {
        if (f.required) errors[f.key] = '選了「其他」請填寫內容';
        values[f.key] = f.required ? OTHER : '';
      } else {
        values[f.key] = otherText;
      }
      continue;
    }

    if (f.required && value === '') {
      errors[f.key] = '此欄位必填';
      values[f.key] = value;
      continue;
    }
    if (value === '') {
      values[f.key] = '';
      continue;
    }

    if (isChoiceType(f.type)) {
      if (!f.options.includes(value)) {
        errors[f.key] = '選項不合法';
      }
    } else if (f.type === 'number') {
      if (!/^-?\d+(\.\d+)?$/.test(value)) {
        errors[f.key] = '請輸入數字';
      }
    } else if (f.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        errors[f.key] = '請輸入正確日期格式 (YYYY-MM-DD)';
      }
    } else if (isTextType(f.type) && f.regex) {
      try {
        if (!new RegExp(f.regex).test(value)) {
          errors[f.key] = f.regexMessage || '格式不符合規定';
        }
      } catch {
        // 無效的 regex 設定：略過驗證，避免整張表卡住
      }
    }

    values[f.key] = value;
  }

  return { valid: Object.keys(errors).length === 0, errors, values };
}
