import {credentialTextPattern,credentialLabelPattern,credentialValues,sensitiveTarget} from './privacy.mjs';

// Inspect DOM text before capture. No OCR claims for pixels in images/canvas/video.
// An inspection failure must omit the screenshot, never fall back to an unmasked capture.
export async function screenshotProtection(page,{knownSecrets,sensitiveControls=[]}){
 const masks=[...sensitiveControls];let frames=0;
 for(const frame of page.frames()){
  const body=await frame.locator('body').innerText({timeout:2000});
  if(Buffer.byteLength(body)>2*1024*1024)throw Error('截图文字检查超过2MiB预算，未保存截图');
  for(const value of credentialValues(body))knownSecrets.add(value);
  const controls=await frame.locator('input,textarea').evaluateAll(elements=>elements.map(e=>({type:e.type,name:e.name,autocomplete:e.autocomplete,label:e.getAttribute('aria-label'),value:e.value})));
  for(const [index,c] of controls.entries())if(sensitiveTarget({type:c.type,name:c.name,autocomplete:c.autocomplete,label:c.label})){masks.push(frame.locator('input,textarea').nth(index));if(c.value)knownSecrets.add(c.value);}
  masks.push(frame.locator('input[type="password"],input[autocomplete="current-password"],input[autocomplete="new-password"],input[name*="token" i],input[name*="secret" i],input[name*="password" i]'));
  masks.push(frame.getByText(credentialTextPattern));
  masks.push(frame.getByText(credentialLabelPattern).locator('..'));
  for(const value of knownSecrets)if(value)masks.push(frame.getByText(value,{exact:false}));
  frames++;
 }
 return {masks,policy:'dom-credentials-v2',frames,limitations:['图片、画布和视频中的文字未做OCR识别']};
}
