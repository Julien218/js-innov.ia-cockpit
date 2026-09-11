export function missingRequiredField(fields, data) {
  return fields.find((field, index) => {
    const value = data?.[field.key || field.name || `field_${index}`];
    return field.required && (value === undefined || value === null || String(value).trim() === '');
  });
}

export function numericInput(value) {
  return value === '' || !Number.isFinite(Number(value)) ? '' : Number(value);
}
