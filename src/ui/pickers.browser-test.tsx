import '../styles.css'
import { useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { OutputFormat } from '../core/codecs/encode'
import { CopyProvider, en } from './copy'
import { createFormatters, DEFAULT_LOCALE } from './format'
import { FormatPicker } from './FormatPicker'
import { DEFAULT_RESIZE, type ResizeChoice } from './resize-choice'
import { ResizePicker } from './ResizePicker'

/**
 * The two pickers on their own, with a stand-in for the state App keeps. What
 * is checked here is the control: opening, choosing, typing, the keyboard, and
 * what it says. That the choice reaches the workers is App's test.
 */

const formatters = createFormatters(DEFAULT_LOCALE)

function ResizeHarness({ spy }: { readonly spy: (choice: ResizeChoice) => void }) {
  const [choice, setChoice] = useState<ResizeChoice>(DEFAULT_RESIZE)
  return (
    <ResizePicker
      choice={choice}
      formatters={formatters}
      onChange={(next) => {
        spy(next)
        setChoice(next)
      }}
    />
  )
}

function FormatHarness({ spy }: { readonly spy: (format: OutputFormat) => void }) {
  const [format, setFormat] = useState<OutputFormat>('webp')
  return (
    <FormatPicker
      selected={format}
      formatters={formatters}
      onSelect={(next) => {
        spy(next)
        setFormat(next)
      }}
    />
  )
}

describe('the resize picker', () => {
  it('starts at 50 % and opens and closes like the destination picker', async () => {
    render(<ResizeHarness spy={vi.fn()} />)

    const button = page.getByRole('button', { name: /^Destino/ })
    await expect.element(button).toHaveTextContent('50 %')
    await expect.element(button).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(button)
    await expect.element(button).toHaveAttribute('aria-expanded', 'true')
    await expect
      .element(page.getByRole('button', { name: '50 %', exact: true }))
      .toHaveAttribute('aria-pressed', 'true')

    await userEvent.keyboard('{Escape}')
    await expect.element(button).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(button)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await expect.element(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens from the keyboard', async () => {
    await render(<ResizeHarness spy={vi.fn()} />)

    page
      .getByRole('button', { name: /^Destino/ })
      .element()
      .focus()
    await userEvent.keyboard('{Enter}')

    await expect.element(page.getByRole('button', { name: 'Porcentaje' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('button', { name: 'Porcentaje' })).not.toBeInTheDocument()
  })

  it('picks a percentage preset', async () => {
    const spy = vi.fn()
    render(<ResizeHarness spy={spy} />)

    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))
    await userEvent.click(page.getByRole('button', { name: '25 %', exact: true }))

    expect(spy).toHaveBeenLastCalledWith({ mode: 'percent', percent: 25 })
    await expect.element(page.getByRole('button', { name: /^Destino/ })).toHaveTextContent('25 %')
  })

  it('takes a typed percentage, and says when it is not one', async () => {
    const spy = vi.fn()
    render(<ResizeHarness spy={spy} />)
    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))

    await userEvent.fill(page.getByLabelText('Otro'), '100')
    await userEvent.click(page.getByRole('button', { name: 'Usar' }))
    await expect.element(page.getByRole('alert')).toHaveTextContent(/entero entre 1 y 99/)
    expect(spy).not.toHaveBeenCalled()

    await userEvent.fill(page.getByLabelText('Otro'), '33')
    await userEvent.click(page.getByRole('button', { name: 'Usar' }))
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    expect(spy).toHaveBeenLastCalledWith({ mode: 'percent', percent: 33 })
    await expect.element(page.getByRole('button', { name: /^Destino/ })).toHaveTextContent('33 %')
  })

  it('takes a maximum size by width, by height or by both', async () => {
    const spy = vi.fn()
    render(<ResizeHarness spy={spy} />)
    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))
    await userEvent.click(page.getByRole('button', { name: 'Tamaño máximo' }))

    // Nothing applied by opening the tab.
    expect(spy).not.toHaveBeenCalled()

    await userEvent.click(page.getByRole('button', { name: 'Usar' }))
    await expect.element(page.getByRole('alert')).toHaveTextContent(/enteros de píxeles/)

    await userEvent.fill(page.getByLabelText('Ancho'), '400')
    await userEvent.click(page.getByRole('button', { name: 'Usar' }))
    expect(spy).toHaveBeenLastCalledWith({ mode: 'box', width: 400, height: null })
    await expect
      .element(page.getByRole('button', { name: /^Destino/ }))
      .toHaveTextContent('máx. 400 px de ancho')

    await userEvent.fill(page.getByLabelText('Ancho'), '')
    await userEvent.fill(page.getByLabelText('Alto'), '300')
    await userEvent.click(page.getByRole('button', { name: 'Usar' }))
    expect(spy).toHaveBeenLastCalledWith({ mode: 'box', width: null, height: 300 })

    await userEvent.fill(page.getByLabelText('Ancho'), '800')
    await userEvent.fill(page.getByLabelText('Alto'), '30000')
    await userEvent.click(page.getByRole('button', { name: 'Usar' }))
    await expect.element(page.getByRole('alert')).toBeVisible()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('offers neutral box presets', async () => {
    const spy = vi.fn()
    render(<ResizeHarness spy={spy} />)
    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))
    await userEvent.click(page.getByRole('button', { name: 'Tamaño máximo' }))

    for (const label of [
      '1920 px de ancho',
      '1280 px de ancho',
      '800 px de ancho',
      '1920 × 1080',
      '1080 × 1080',
    ]) {
      await expect.element(page.getByRole('button', { name: label, exact: true })).toBeVisible()
    }

    await userEvent.click(page.getByRole('button', { name: '1920 × 1080', exact: true }))
    expect(spy).toHaveBeenLastCalledWith({ mode: 'box', width: 1920, height: 1080 })

    const panel = document.body.textContent ?? ''
    expect(panel).not.toMatch(/instagram|whatsapp|facebook|youtube|twitter|discord|tiktok/i)
  })

  it('says what it does and does not do', async () => {
    render(<ResizeHarness spy={vi.fn()} />)
    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))

    await expect.element(page.getByText(/Solo reduce/)).toBeVisible()
    await expect.element(page.getByText(/no recorta/)).toBeVisible()
    await expect.element(page.getByText(/calidad es fija: 85/)).toBeVisible()
  })

  it('speaks English on the English page', async () => {
    const { container } = await render(
      <CopyProvider value={en}>
        <ResizeHarness spy={vi.fn()} />
      </CopyProvider>,
    )

    await userEvent.click(page.getByRole('button', { name: /^Destination/ }))
    await expect.element(page.getByRole('button', { name: 'Maximum size' })).toBeVisible()
    await expect.element(page.getByText(/only makes images smaller/)).toBeVisible()
    expect(container.textContent ?? '').not.toMatch(/[áéíóúñ]/i)
  })
})

describe('the format picker', () => {
  it('starts at WebP and opens and closes like the destination picker', async () => {
    render(<FormatHarness spy={vi.fn()} />)

    const button = page.getByRole('button', { name: /^Destino/ })
    await expect.element(button).toHaveTextContent('WebP')
    await expect.element(button).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(button)
    await expect.element(button).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{Escape}')
    await expect.element(button).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(button)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await expect.element(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('lists the four formats with their notes and fixed qualities', async () => {
    render(<FormatHarness spy={vi.fn()} />)
    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))

    await expect.element(page.getByText('se compone sobre blanco', { exact: false })).toBeVisible()
    await expect.element(page.getByText(/Sin pérdida y con transparencia/)).toBeVisible()
    await expect.element(page.getByText(/Pesa poco y conserva la transparencia/)).toBeVisible()
    await expect.element(page.getByText(/tarda más en codificar/)).toBeVisible()
    await expect.element(page.getByText('calidad 85')).toBeVisible()
    await expect.element(page.getByText('calidad 80')).toBeVisible()
    await expect.element(page.getByText('calidad 60')).toBeVisible()
    await expect.element(page.getByText('sin pérdida', { exact: true })).toBeVisible()
  })

  it('chooses with the mouse and closes', async () => {
    const spy = vi.fn()
    render(<FormatHarness spy={spy} />)

    await userEvent.click(page.getByRole('button', { name: /^Destino/ }))
    await userEvent.click(page.getByRole('button', { name: /^JPEG/ }))

    expect(spy).toHaveBeenCalledWith('jpeg')
    await expect.element(page.getByRole('button', { name: /^Destino/ })).toHaveTextContent('JPEG')
    await expect.element(page.getByRole('button', { name: /^AVIF/ })).not.toBeInTheDocument()
  })

  it('chooses with the keyboard', async () => {
    const spy = vi.fn()
    await render(<FormatHarness spy={spy} />)

    page
      .getByRole('button', { name: /^Destino/ })
      .element()
      .focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('{Tab}{Tab}{Enter}')

    // Tab order after the trigger: JPEG, PNG, WebP, AVIF. Two presses, PNG.
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('png')
    await expect.element(page.getByRole('button', { name: /^JPEG/ })).not.toBeInTheDocument()
  })

  it('speaks English on the English page', async () => {
    const { container } = await render(
      <CopyProvider value={en}>
        <FormatHarness spy={vi.fn()} />
      </CopyProvider>,
    )

    await userEvent.click(page.getByRole('button', { name: /^Destination/ }))
    await expect.element(page.getByText(/placed over white/)).toBeVisible()
    await expect.element(page.getByText(/slower to encode/)).toBeVisible()
    expect(container.textContent ?? '').not.toMatch(/[áéíóúñ]/i)
  })
})
