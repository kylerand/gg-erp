export interface ButtonProps {
  id: string;
  label: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

export function createButtonProps(props: ButtonProps): ButtonProps {
  return {
    variant: 'primary',
    disabled: false,
    ...props
  };
}
