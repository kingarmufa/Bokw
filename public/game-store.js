'use strict';
document.querySelectorAll('[data-confirm]').forEach(f=>f.addEventListener('submit',e=>{if(!confirm(f.dataset.confirm))e.preventDefault();}));
document.querySelectorAll('[data-photo]').forEach(b=>b.addEventListener('click',()=>{document.getElementById('gs-main-image').src=b.dataset.photo;}));
document.getElementById('gs-go-back')?.addEventListener('click',()=>history.back());
const ch=document.getElementById('gs-channel');
ch?.addEventListener('change',()=>{const tg=ch.value==='telegram';document.getElementById('gs-prefix').textContent=tg?'t.me/':'wa.me/';document.getElementById('gs-contact-label').textContent=tg?'Username Telegram *':'Nomor WhatsApp *';document.getElementById('gs-contact').placeholder=tg?'username':'628123456789';});
document.querySelectorAll('[data-upload-form]').forEach(form=>{
 const input=form.querySelector('[data-photo-input]'), preview=form.querySelector('[data-preview]'), error=form.querySelector('[data-form-error]'); let urls=[];
 const validate=()=>{const files=[...input.files];if(files.length<Number(input.dataset.min)||files.length>Number(input.dataset.max))return `Pilih ${input.dataset.min}–${input.dataset.max} foto.`;if(files.some(f=>f.size>5*1024*1024))return 'Maksimal 5 MB per foto.';if(files.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type)))return 'Gunakan foto JPG, PNG, atau WebP.';return '';};
 input.addEventListener('change',()=>{urls.forEach(URL.revokeObjectURL);urls=[];preview.replaceChildren();error.textContent=validate();if(error.textContent)return;[...input.files].forEach(f=>{const img=document.createElement('img');img.alt=f.name;img.src=URL.createObjectURL(f);urls.push(img.src);preview.append(img);});});
 form.addEventListener('submit',e=>{error.textContent=validate();if(error.textContent){e.preventDefault();return;}const b=form.querySelector('button[type="submit"],button:not([type])');if(b){b.disabled=true;b.textContent='Mengunggah foto… Mohon tunggu';}});
});
