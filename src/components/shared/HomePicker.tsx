import { useTaskStore } from '../../store/taskStore';
import { parseHome, type HomeValue } from '../../lib/items';

/**
 * Where an item belongs: a plain project, a product, a partner, or nothing. Choosing a product
 * shows a second select for a partner, and picking one makes the pair (it is created if new).
 */
export function HomePicker({
  value,
  onChange,
  className,
  label = 'Belongs to',
}: {
  value: HomeValue;
  onChange: (value: HomeValue) => void;
  className?: string;
  label?: string;
}) {
  const { projects, products, partners } = useTaskStore();
  const home = parseHome(value);
  const main = home.project ? `project:${home.project}` : home.product ? `product:${home.product}` : home.partner ? `partner:${home.partner}` : '';

  function pick(next: string) {
    // Keeping a product keeps its partner too.
    if (next === main && home.product && home.partner) return;
    onChange(next);
  }

  return (
    <>
      <select className={className} value={main} onChange={(e) => pick(e.target.value)} aria-label={label}>
        <option value="">No project</option>
        {projects.length > 0 && (
          <optgroup label="Projects">
            {projects.map((p) => (
              <option key={p.id} value={`project:${p.id}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
        {products.length > 0 && (
          <optgroup label="Products">
            {products.map((p) => (
              <option key={p.id} value={`product:${p.id}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
        {partners.length > 0 && (
          <optgroup label="Partners">
            {partners.map((p) => (
              <option key={p.id} value={`partner:${p.id}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {home.product && partners.length > 0 && (
        <select
          className={className}
          value={home.partner}
          onChange={(e) => onChange(e.target.value ? `pair:${home.product}+${e.target.value}` : `product:${home.product}`)}
          aria-label="With partner"
        >
          <option value="">No partner</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              with {p.name}
            </option>
          ))}
        </select>
      )}
    </>
  );
}
