import { Children, cloneElement, useId } from 'react';

/**
 * Keep the accessible name independent of a textarea's current contents.
 * Each field has one control and a stable, unique label association, including
 * repeated controls in the shot editor. Preserve an explicit caller-provided id.
 */
export default function AccessibleField({ label, children }) {
  const generatedId = useId();
  const control = Children.only(children);
  const controlId = control.props.id || generatedId;

  return (
    <div className="block space-y-1 text-xs text-muted-foreground">
      <label htmlFor={controlId} className="block">{label}</label>
      {cloneElement(control, { id: controlId })}
    </div>
  );
}
