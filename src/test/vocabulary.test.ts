import { describe, expect, it } from 'vitest'
import { buildVocabulary, chooseKnownValue } from '../services/vocabulary'

describe('dynamic hospital and department vocabulary', () => {
  it('deduplicates values from the currently referenced records', () => {
    const vocabulary = buildVocabulary([
      { hospital: ' 协和医院 ', department: '肿瘤内科' },
      { hospital: '人民医院', department: '放疗科' },
      { hospital: '协和医院', department: '肿瘤内科' },
    ])

    expect(vocabulary.hospitals).toEqual(['人民医院', '协和医院'])
    expect(vocabulary.departments).toEqual(['放疗科', '肿瘤内科'])
    expect(chooseKnownValue('协和医院', vocabulary.hospitals)).toBe('协和医院')
  })

  it('removes values after the final reference is renamed or deleted', () => {
    const before = buildVocabulary([{ hospital: '旧医院', department: '旧科室' }])
    const afterRename = buildVocabulary([{ hospital: '新医院', department: '新科室' }])
    const afterDelete = buildVocabulary([])

    expect(before.hospitals).toContain('旧医院')
    expect(afterRename).toEqual({ hospitals: ['新医院'], departments: ['新科室'] })
    expect(afterDelete).toEqual({ hospitals: [], departments: [] })
  })
})
