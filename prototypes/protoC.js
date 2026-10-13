// Prototype C: side panels open as drawers from two edge tabs (closed by default for a full-screen map).
document.addEventListener('DOMContentLoaded',()=>{
 const mk=(id,label,cls)=>{const b=document.createElement('button');b.id=id;b.type='button';b.className='drawerBtn';b.textContent=label;
  b.onclick=()=>{const on=document.body.classList.toggle(cls);b.classList.toggle('on',on);};document.body.appendChild(b);};
 mk('drawerLeft','📊  INDICES','showLeft');
 mk('drawerRight','📈  INSIGHTS','showRight');
});
