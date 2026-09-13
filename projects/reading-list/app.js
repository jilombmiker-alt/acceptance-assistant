const key='reading-list';let books=JSON.parse(localStorage.getItem(key)||'[]');
const form=document.querySelector('#add-form'),list=document.querySelector('#books'),filter=document.querySelector('#filter'),notice=document.querySelector('#notice');
function save(){localStorage.setItem(key,JSON.stringify(books));render()}
function render(){list.replaceChildren();document.querySelector('[data-testid=summary]').textContent=`共 ${books.length} 本，已读 ${books.filter(b=>b.read).length} 本`;for(const book of books.filter(b=>filter.value==='all'||b.read)){const li=document.createElement('li'),span=document.createElement('span'),button=document.createElement('button');span.textContent=book.title+' · '+(book.read?'已读':'未读');button.textContent=book.read?'标记未读':'标记已读';button.setAttribute('aria-label',button.textContent+' '+book.title);button.onclick=()=>{book.read=!book.read;save();notice.textContent='阅读状态已保存'};li.append(span,button);list.append(li)}}
form.onsubmit=e=>{e.preventDefault();const title=form.elements.title.value.trim();if(!title)return;books.push({title,read:false});save();form.reset();notice.textContent='书目已保存'};
filter.onchange=render;
document.querySelector('#export').onclick=()=>{const data=books.map(({title,read})=>({title,read}));const blob=new Blob([JSON.stringify({books:data},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='reading-list.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice.textContent='导出完成'};
render();
