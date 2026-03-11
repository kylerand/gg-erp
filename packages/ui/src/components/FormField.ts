export interface FormFieldModel {
  name: string;
  label: string;
  required?: boolean;
  error?: string;
}

export function validateRequiredField(value: string, model: FormFieldModel): string | undefined {
  if (model.required && !value.trim()) {
    return model.error ?? `${model.label} is required`;
  }
  return undefined;
}
