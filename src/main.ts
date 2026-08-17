import './styles.css'

const app = document.querySelector<HTMLElement>('#app')

if (app === null) {
  throw new Error('Mount point #app is missing from index.html')
}

app.textContent = 'achica'
