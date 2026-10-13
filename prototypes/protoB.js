// Prototype B (light theme): chart text colours that were chosen for dark panels are switched to dark slate.
// Loaded right after Chart.js and before the portal script, so every chart (also ones created later) is covered.
(function(){
 if(typeof Chart==='undefined')return;
 const LIGHT=/^(#a8b8c6|#cbd5e1|#86a3b2|#7895a4|#a9c0cb|#b5cad4|#6d8ea1)$/i; // the dark-theme greys
 const fix=c=>typeof c==='string'&&LIGHT.test(c)?'#475569':c;
 Chart.defaults.color='#475569';
 Chart.register({id:'protoBLightText',beforeUpdate(ch){
  const o=ch.options;
  for(const k in (o.scales||{})){const s=o.scales[k];if(s.ticks)s.ticks.color=fix(s.ticks.color);if(s.title)s.title.color=fix(s.title.color);
   if(s.grid&&typeof s.grid.color==='string'&&s.grid.color.includes('148,163,184'))s.grid.color='rgba(15,23,42,.08)';}
  const lg=o.plugins&&o.plugins.legend&&o.plugins.legend.labels;if(lg)lg.color=fix(lg.color)||'#334155';
 }});
})();
