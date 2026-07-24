import { getChemotherapyDayMedications, getChemotherapyTemplateDayPlans } from '../../services/chemotherapy'
import {
  CHEMOTHERAPY_DOSE_UNITS,
  TREATMENT_PLAN_TYPES,
  newId,
  type ChemotherapyMedication,
  type ChemotherapyTemplate,
  type ChemotherapyTemplateDayPlan,
  type TreatmentPlanType,
} from '../../types'
import type { ChoiceOption } from '../ChoicePicker'

export const chemotherapyDoseUnitOptions: ChoiceOption[] = CHEMOTHERAPY_DOSE_UNITS.map((unit) => ({
  value: unit.value,
  label: unit.value,
  description: unit.label.replace(unit.value, '').replace(/^（|）$/g, ''),
}))

export const treatmentPlanTypeOptions: ChoiceOption[] = Object.entries(TREATMENT_PLAN_TYPES).map(([value, type]) => ({
  value,
  label: type.label,
  description: type.description,
  color: type.color,
}))

export const getTreatmentPlanType = (template?: ChemotherapyTemplate): TreatmentPlanType =>
  template?.templateType ?? 'chemotherapy'

export const blankMedication = (): ChemotherapyMedication => ({
  id: newId(),
  name: '',
  dose: '',
  unit: '',
  administration: '',
  notes: '',
})

export const blankDayPlan = (day: number): ChemotherapyTemplateDayPlan => ({
  id: newId(),
  day,
  medicationItems: [blankMedication()],
  notes: '',
})

export function editableDayPlans(template?: ChemotherapyTemplate) {
  if (!template) return [blankDayPlan(1)]
  return getChemotherapyTemplateDayPlans(template).map((plan) => ({
    ...plan,
    medicationItems: getChemotherapyDayMedications(plan).length
      ? getChemotherapyDayMedications(plan)
      : [blankMedication()],
  }))
}
