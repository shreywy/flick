import '@fontsource/schibsted-grotesk/400.css'
import '@fontsource/schibsted-grotesk/500.css'
import '@fontsource/schibsted-grotesk/600.css'
import '@fontsource/schibsted-grotesk/700.css'
import '@fontsource/schibsted-grotesk/800.css'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './player.css'

createRoot(document.getElementById('root')!).render(<App />)
