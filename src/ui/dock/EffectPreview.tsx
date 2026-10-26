import type { CSSProperties } from 'react';
import type { EffectDefinition } from '../../catalog/schema';

/** Original CSS artwork per template, captioned with the definition's own text. */
export function EffectPreview({ def }: { def: EffectDefinition }) {
  let caption = '';
  let style: CSSProperties | undefined;
  switch (def.template) {
    case 'cinema':
      caption = def.parameters.title ?? 'ABSOLUTE CINEMA';
      break;
    case 'aura':
      caption = `+${(def.parameters.score ?? 9999).toLocaleString('en-US')}`;
      style = { ['--sm-hue' as string]: String(def.parameters.hue ?? 275) };
      break;
    case 'dramatic-zoom':
    case 'confused-freeze':
    case 'impact-caption':
    case 'illustrated-fire':
      caption = def.parameters.caption ?? def.title;
      break;
    case 'success-title':
      caption = def.parameters.title ?? 'MISSION PASSED';
      break;
    case 'dust-away':
      caption = '';
      break;
  }
  const figure = def.template !== 'cinema' && def.template !== 'success-title' && def.template !== 'impact-caption';
  return (
    <div className={`sm-art ${def.template}`} style={style} aria-hidden="true">
      {figure && <div className="sm-figure" />}
      {caption && <span className="sm-cap">{caption}</span>}
    </div>
  );
}
