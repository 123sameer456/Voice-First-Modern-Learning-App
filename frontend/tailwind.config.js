/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      boxShadow: {
        card: '0 4px 24px -6px rgb(56 189 248 / 0.15)',
      },
    },
  },
  plugins: [],
}
