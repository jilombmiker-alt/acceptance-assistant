// Conservative credential protection, not a general personal-data classifier.
export const REDACTED = '[REDACTED]';
export const OMITTED_INPUT = '[INPUT_NOT_RECORDED]';
const keyPattern = /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|pwd|api[ _-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|token|credential|密码|口令|密钥|令牌|凭据)$/i;
export const sensitiveTarget = spec => /password|passwd|api[ _-]?key|token|secret|credential|密码|口令|密钥|令牌|凭据/i.test(JSON.stringify(spec || {}));

export function redactText(value, secrets = []) {
  let text = String(value);
  for (const secret of [...secrets].filter(x => typeof x === 'string' && x.length).sort((a,b)=>b.length-a.length)) {
    // Include common URL/HTML encodings used by logs and server echoes.
    for(const form of new Set([secret, encodeURIComponent(secret), secret.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')])) text = text.split(form).join(REDACTED);
  }
  text = text.replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/g, REDACTED);
  text = text.replace(/\b(Bearer|Basic)[ \t]+[^\s"'<>;,]+/gi, '$1 '+REDACTED);
  text = text.replace(/((?:["']?(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|pwd|api[ _-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|token|密码|口令|密钥|令牌|凭据)["']?)[ \t]*[:=：][ \t]*)(?:\r?\n[ \t]*)?[^\r\n]*/gi, '$1'+REDACTED);
  text = text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1'+REDACTED+'@');
  return text;
}

export function sanitize(value, {secrets = [], omitInputs = false} = {}) {
  if (typeof value === 'string') return redactText(value, secrets);
  if (Array.isArray(value)) return value.map(v => sanitize(v, {secrets, omitInputs}));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (keyPattern.test(key)) result[key] = REDACTED;
    else if (omitInputs && value.type === 'fill' && key === 'value') {
      result.value = OMITTED_INPUT;
      result.valueOmitted = true;
    } else result[key] = sanitize(child, {secrets, omitInputs});
  }
  return result;
}

// Shared rules for pre-existing page text and later textual evidence.
const credentialNames='authorization|proxy-authorization|cookie|set-cookie|password|passwd|pwd|api[ _-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|token|密码|口令|密钥|令牌|凭据';
export const credentialTextPattern=new RegExp('(?:'+credentialNames+')["\u0027]?\\s*[:=：]\\s*\\S|\\b(?:Bearer|Basic)\\s+\\S|-----BEGIN [^-]*PRIVATE KEY-----','i');
export const credentialLabelPattern=new RegExp('^(?:'+credentialNames+')\\s*[:：]?\\s*$','i');
export function credentialValues(text){
 const values=new Set();
 const lines=String(text).split(/\r?\n/);
 for(let i=0;i<lines.length-1;i++)if(credentialLabelPattern.test(lines[i].trim())&&lines[i+1].trim())values.add(lines[i+1].trim());
 const pattern=new RegExp('(?:'+credentialNames+')["\u0027]?\\s*[:=：]\\s*["\u0027]?([^\\r\\n"\u0027]+)','gi');
 for(const m of String(text).matchAll(pattern)){const value=m[1].trim();if(value)values.add(value);}
 for(const m of String(text).matchAll(/\b(?:Bearer|Basic)[ \t]+([^\s"'<>;,]+)/gi))values.add(m[1]);
 return values;
}
