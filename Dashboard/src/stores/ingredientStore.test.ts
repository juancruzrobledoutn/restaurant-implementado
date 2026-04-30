/**
 * ingredientStore unit tests — three-level hierarchy: groups, ingredients, subIngredients.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useIngredientStore } from './ingredientStore'
import type { IngredientGroup, Ingredient } from '@/types/menu'

vi.mock('@/services/api', () => ({ fetchAPI: vi.fn() }))
vi.mock('@/utils/logger', () => ({
  logger: { debug: vi.fn() },
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))
vi.mock('@/stores/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { fetchAPI } from '@/services/api'
const mockFetchAPI = fetchAPI as ReturnType<typeof vi.fn>

function makeBackendGroup(overrides: Record<string, unknown> = {}) {
  return { id: 1, tenant_id: 10, name: 'Lácteos', is_active: true, ...overrides }
}

function makeBackendIngredient(overrides: Record<string, unknown> = {}) {
  return { id: 10, group_id: 1, tenant_id: 10, name: 'Leche', unit: 'ml', is_active: true, ...overrides }
}

function makeBackendSub(overrides: Record<string, unknown> = {}) {
  return { id: 100, ingredient_id: 10, tenant_id: 10, name: 'Leche entera', quantity: 200, unit: 'ml', is_active: true, ...overrides }
}

beforeEach(() => {
  useIngredientStore.setState({
    groups: [], ingredients: [], subIngredients: [],
    isLoading: false, error: null, pendingTempIds: new Set(),
  })
  vi.clearAllMocks()
})

describe('fetchGroupsAsync', () => {
  it('loads groups with string IDs', async () => {
    mockFetchAPI.mockResolvedValueOnce([makeBackendGroup(), makeBackendGroup({ id: 2, name: 'Cereales' })])
    await useIngredientStore.getState().fetchGroupsAsync()
    const { groups } = useIngredientStore.getState()
    expect(groups).toHaveLength(2)
    expect(groups[0]!.id).toBe('1')
    expect(groups[0]!.tenant_id).toBe('10')
  })

  it('sets error on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('net'))
    await useIngredientStore.getState().fetchGroupsAsync()
    expect(useIngredientStore.getState().error).toBe('error:ingredientStore.fetchGroupsAsync')
  })
})

describe('createGroupAsync', () => {
  it('optimistic insert then real replace', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackendGroup({ id: 5 }))
    const promise = useIngredientStore.getState().createGroupAsync({ name: 'Lácteos', is_active: true })
    expect(useIngredientStore.getState().groups.some((g) => g._optimistic)).toBe(true)
    const result = await promise
    expect(result.id).toBe('5')
    expect(useIngredientStore.getState().groups[0]!._optimistic).toBeUndefined()
  })

  it('rollback on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    await expect(useIngredientStore.getState().createGroupAsync({ name: 'X', is_active: true })).rejects.toThrow()
    expect(useIngredientStore.getState().groups).toHaveLength(0)
  })
})

describe('updateGroupAsync', () => {
  const existing: IngredientGroup = { id: '1', tenant_id: '10', name: 'Old', is_active: true }

  beforeEach(() => { useIngredientStore.setState({ groups: [existing] }) })

  it('optimistic update + server replace', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackendGroup({ id: 1, name: 'Updated' }))
    await useIngredientStore.getState().updateGroupAsync('1', { name: 'Updated', is_active: true })
    expect(useIngredientStore.getState().groups[0]!.name).toBe('Updated')
  })

  it('rollback on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    try { await useIngredientStore.getState().updateGroupAsync('1', { name: 'X', is_active: true }) } catch { /* expected */ }
    expect(useIngredientStore.getState().groups[0]!.name).toBe('Old')
  })
})

describe('deleteGroupAsync', () => {
  const group: IngredientGroup = { id: '1', tenant_id: '10', name: 'Lácteos', is_active: true }
  const ingredient: Ingredient = { id: '10', group_id: '1', tenant_id: '10', name: 'Leche', is_active: true }

  beforeEach(() => {
    useIngredientStore.setState({
      groups: [group],
      ingredients: [ingredient],
      subIngredients: [
        { id: '100', ingredient_id: '10', tenant_id: '10', name: 'Entera', is_active: true },
      ],
    })
  })

  it('removes group and its children optimistically', () => {
    mockFetchAPI.mockResolvedValueOnce(undefined)
    void useIngredientStore.getState().deleteGroupAsync('1')
    const state = useIngredientStore.getState()
    expect(state.groups).toHaveLength(0)
    expect(state.ingredients).toHaveLength(0)
    expect(state.subIngredients).toHaveLength(0)
  })

  it('restores all on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    try { await useIngredientStore.getState().deleteGroupAsync('1') } catch { /* expected */ }
    const state = useIngredientStore.getState()
    expect(state.groups).toHaveLength(1)
    expect(state.ingredients).toHaveLength(1)
    expect(state.subIngredients).toHaveLength(1)
  })
})

describe('createIngredientAsync', () => {
  it('optimistic insert then real replace', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackendIngredient({ id: 20 }))
    const result = await useIngredientStore.getState().createIngredientAsync({
      name: 'Leche', unit: 'ml', is_active: true, group_id: '1',
    })
    expect(result.id).toBe('20')
    expect(result.group_id).toBe('1')
  })
})

describe('applyWSCreated / applyWSUpdated / applyWSDeleted', () => {
  it('routes ingredient_group entity to groups', () => {
    useIngredientStore.getState().applyWSCreated('ingredient_group', makeBackendGroup({ id: 99 }))
    expect(useIngredientStore.getState().groups).toHaveLength(1)
    expect(useIngredientStore.getState().groups[0]!.id).toBe('99')
  })

  it('routes ingredient entity to ingredients', () => {
    useIngredientStore.getState().applyWSCreated('ingredient', makeBackendIngredient({ id: 88 }))
    expect(useIngredientStore.getState().ingredients).toHaveLength(1)
  })

  it('routes sub_ingredient entity to subIngredients', () => {
    useIngredientStore.getState().applyWSCreated('sub_ingredient', makeBackendSub({ id: 77 }))
    expect(useIngredientStore.getState().subIngredients).toHaveLength(1)
  })

  it('applyWSUpdated merges group', () => {
    const g: IngredientGroup = { id: '1', tenant_id: '10', name: 'Old', is_active: true }
    useIngredientStore.setState({ groups: [g] })
    useIngredientStore.getState().applyWSUpdated('ingredient_group', makeBackendGroup({ id: 1, name: 'WS' }))
    expect(useIngredientStore.getState().groups[0]!.name).toBe('WS')
  })

  it('applyWSDeleted removes ingredient', () => {
    const i: Ingredient = { id: '10', group_id: '1', tenant_id: '10', name: 'X', is_active: true }
    useIngredientStore.setState({ ingredients: [i] })
    useIngredientStore.getState().applyWSDeleted('ingredient', '10')
    expect(useIngredientStore.getState().ingredients).toHaveLength(0)
  })
})
