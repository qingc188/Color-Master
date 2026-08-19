module.exports = {
    content: ['./index.html', './app.js'],
    theme: {
        extend: {
            colors: {
                primary: '#5ec8c2',
                secondary: '#f36f63',
                success: '#5ec8c2',
                danger: '#f36f63',
                dark: '#071820',
                light: '#f4efe6'
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif']
            },
            animation: {
                'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'bounce-fast': 'bounce 0.5s infinite',
                'fade-in': 'fadeIn 0.5s ease-in-out',
                'scale-in': 'scaleIn 0.3s ease-in-out',
                shake: 'shake 0.5s cubic-bezier(.36,.07,.19,.97) both'
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' }
                },
                scaleIn: {
                    '0%': { transform: 'scale(0.9)', opacity: '0' },
                    '100%': { transform: 'scale(1)', opacity: '1' }
                },
                shake: {
                    '10%, 90%': { transform: 'translate3d(-1px, 0, 0)' },
                    '20%, 80%': { transform: 'translate3d(2px, 0, 0)' },
                    '30%, 50%, 70%': { transform: 'translate3d(-4px, 0, 0)' },
                    '40%, 60%': { transform: 'translate3d(4px, 0, 0)' }
                }
            }
        }
    }
};
