/**
 * settingsAPI tests (C-28 — task 9.4).
 *
 * Coverage:
 * - getBranchSettings: 200 OK → BranchSettings with ID conversion (number → string)
 * - updateBranchSettings: 200 OK → BranchSettings with patch applied
 * - updateBranchSettings: 409 slug duplicado → APIError thrown
 * - getTenantSettings: 200 OK → TenantSettings with ID conversion
 * - updateTenantSettings: 200 OK → TenantSettings with patch applied
 * - updateTenantSettings: 403 MANAGER → APIError thrown
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/config/env', () => ({
  env: { API_URL: 'http://localhost:8000', WS_URL: 'ws://localhost:8001' },
}))

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    fetchAPI: vi.fn(),
  }
})

import { fetchAPI } from './api'
import { APIError } from './api'
import {
  getBranchSettings,
  updateBranchSettings,
  getTenantSettings,
  updateTenantSettings,
} from './settingsAPI'

const mockFetchAPI = fetchAPI as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const backendBranchSettings = {
  id: 3,
  tenant_id: 1,
  name: 'Sucursal Centro',
  address: 'Av. Siempreviva 742',
  slug: 'sucursal-centro',
  phone: '+54 9 351 000-0000',
  timezone: 'America/Argentina/Cordoba',
  opening_hours: {
    mon: [{ open: '09:00', close: '22:00' }],
    tue: [{ open: '09:00', close: '22:00' }],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  },
}

const backendTenantSettings = {
  id: 1,
  name: 'Buen Sabor SRL',
}

function makeAPIError(status: number, message: string): APIError {
  return new APIError(status, message)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// getBranchSettings
// ---------------------------------------------------------------------------

describe('getBranchSettings', () => {
  it('returns BranchSettings with IDs converted to strings on 200', async () => {
    mockFetchAPI.mockResolvedValueOnce(backendBranchSettings)

    const result = await getBranchSettings('3')

    expect(typeof result.id).toBe('string')
    expect(typeof result.tenant_id).toBe('string')
    expect(result.id).toBe('3')
    expect(result.tenant_id).toBe('1')
    expect(result.name).toBe('Sucursal Centro')
    expect(result.slug).toBe('sucursal-centro')
    expect(result.timezone).toBe('America/Argentina/Cordoba')
    expect(result.phone).toBe('+54 9 351 000-0000')
  })

  it('calls fetchAPI with the correct endpoint', async () => {
    mockFetchAPI.mockResolvedValueOnce(backendBranchSettings)

    await getBranchSettings('3')

    expect(mockFetchAPI).toHaveBeenCalledOnce()
    expect(mockFetchAPI).toHaveBeenCalledWith('/api/admin/branches/3/settings')
  })

  it('propagates APIError on 403', async () => {
    mockFetchAPI.mockRejectedValueOnce(makeAPIError(403, 'Branch access denied'))

    await expect(getBranchSettings('99')).rejects.toThrow(APIError)
  })

  it('propagates APIError on 404 (cross-tenant)', async () => {
    mockFetchAPI.mockRejectedValueOnce(makeAPIError(404, 'Branch not found'))

    await expect(getBranchSettings('999')).rejects.toThrow(APIError)
  })
})

// ---------------------------------------------------------------------------
// updateBranchSettings
// ---------------------------------------------------------------------------

describe('updateBranchSettings', () => {
  it('returns updated BranchSettings with IDs as strings on 200', async () => {
    const updated = { ...backendBranchSettings, name: 'Sucursal Sur' }
    mockFetchAPI.mockResolvedValueOnce(updated)

    const result = await updateBranchSettings('3', { name: 'Sucursal Sur' })

    expect(result.name).toBe('Sucursal Sur')
    expect(typeof result.id).toBe('string')
    expect(result.id).toBe('3')
  })

  it('calls PATCH on the correct endpoint', async () => {
    mockFetchAPI.mockResolvedValueOnce(backendBranchSettings)

    const patch = { slug: 'nuevo-slug', timezone: 'America/Buenos_Aires' }
    await updateBranchSettings('3', patch)

    expect(mockFetchAPI).toHaveBeenCalledWith('/api/admin/branches/3', {
      method: 'PATCH',
      body: patch,
    })
  })

  it('throws APIError on 409 (slug duplicado)', async () => {
    mockFetchAPI.mockRejectedValueOnce(makeAPIError(409, 'slug already in use'))

    await expect(updateBranchSettings('3', { slug: 'duplicado' })).rejects.toThrow(APIError)
  })

  it('throws APIError on 422 (timezone inválido)', async () => {
    mockFetchAPI.mockRejectedValueOnce(makeAPIError(422, 'Invalid timezone'))

    await expect(
      updateBranchSettings('3', { timezone: 'Not/ATimezone' }),
    ).rejects.toThrow(APIError)
  })
})

// ---------------------------------------------------------------------------
// getTenantSettings
// ---------------------------------------------------------------------------

describe('getTenantSettings', () => {
  it('returns TenantSettings with ID as string on 200', async () => {
    mockFetchAPI.mockResolvedValueOnce(backendTenantSettings)

    const result = await getTenantSettings()

    expect(typeof result.id).toBe('string')
    expect(result.id).toBe('1')
    expect(result.name).toBe('Buen Sabor SRL')
  })

  it('calls fetchAPI with correct endpoint', async () => {
    mockFetchAPI.mockResolvedValueOnce(backendTenantSettings)

    await getTenantSettings()

    expect(mockFetchAPI).toHaveBeenCalledWith('/api/admin/tenants/me')
  })

  it('throws APIError on 403 (MANAGER no puede ver tenant)', async () => {
    mockFetchAPI.mockRejectedValueOnce(makeAPIError(403, 'Admin only'))

    await expect(getTenantSettings()).rejects.toThrow(APIError)
  })
})

// ---------------------------------------------------------------------------
// updateTenantSettings
// ---------------------------------------------------------------------------

describe('updateTenantSettings', () => {
  it('returns updated TenantSettings with ID as string on 200', async () => {
    const updated = { ...backendTenantSettings, name: 'Nuevo Nombre SRL' }
    mockFetchAPI.mockResolvedValueOnce(updated)

    const result = await updateTenantSettings({ name: 'Nuevo Nombre SRL' })

    expect(result.name).toBe('Nuevo Nombre SRL')
    expect(typeof result.id).toBe('string')
    expect(result.id).toBe('1')
  })

  it('calls PATCH on the correct endpoint with patch body', async () => {
    mockFetchAPI.mockResolvedValueOnce(backendTenantSettings)

    const patch = { name: 'Otro Nombre' }
    await updateTenantSettings(patch)

    expect(mockFetchAPI).toHaveBeenCalledWith('/api/admin/tenants/me', {
      method: 'PATCH',
      body: patch,
    })
  })

  it('throws APIError on 403 (MANAGER no puede editar tenant)', async () => {
    mockFetchAPI.mockRejectedValueOnce(makeAPIError(403, 'Admin only'))

    await expect(updateTenantSettings({ name: 'x' })).rejects.toThrow(APIError)
  })

  it('throws APIError on 422 (nombre en blanco)', async () => {
    mockFetchAPI.mockRejectedValueOnce(makeAPIError(422, 'name cannot be blank'))

    await expect(updateTenantSettings({ name: '' })).rejects.toThrow(APIError)
  })
})
