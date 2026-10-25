import * as React from "react"

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'default', size = 'default', ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'

    const variants = {
      default: 'bg-teal-600 text-white hover:bg-teal-700 focus:ring-teal-500',
      outline: 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50 focus:ring-slate-400'
    }

    const sizes = {
      default: 'px-4 py-2 text-sm',
      sm: 'px-3 py-1 text-xs',
      lg: 'px-6 py-3 text-base',
      icon: 'w-10 h-10'
    }

    return (
      <button
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button }
