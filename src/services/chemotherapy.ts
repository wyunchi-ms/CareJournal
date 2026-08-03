import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { TREATMENT_PLAN_TYPES, newId, type ChemotherapyMedication, type ChemotherapyTemplate, type ChemotherapyTemplateDayPlan, type EventType, type TreatmentEvent, type TreatmentPlanType } from '../types'

export type ChemotherapyRescheduleScope = 'single' | 'cycle' | 'future'

export interface ChemotherapyCycle {
  id: string
  dayOne: string
  cycleNumber?: number
  title: string
  events: TreatmentEvent[]
}

interface CourseGenerationOptions {
  firstDayOne: string
  cycleCount: number
  firstCycleNumber?: number
  now?: string
}

const dateString = (date: Date) => format(date, 'yyyy-MM-dd')
const shiftDate = (value: string, days: number) => dateString(addDays(parseISO(value), days))

export function normalizeAdministrationDays(days: number[], cycleLengthDays: number) {
  return [...new Set(days.map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= cycleLengthDays)
    .sort((first, second) => first - second)
}

export function parseAdministrationDays(value: string, cycleLengthDays: number) {
  const days = value
    .toUpperCase()
    .split(/[\s,，、/;；]+/)
    .filter(Boolean)
    .map((item) => Number(item.replace(/^D/, '')))
  return normalizeAdministrationDays(days, cycleLengthDays)
}

function legacyMedicationItems(planId: string, medications?: string, dosage?: string): ChemotherapyMedication[] {
  if (!medications?.trim() && !dosage?.trim()) return []
  return [{
    id: `legacy-medication-${planId}`,
    name: medications?.trim() || '未命名药物',
    administration: dosage?.trim() || undefined,
  }]
}

export function getChemotherapyDayMedications(plan: ChemotherapyTemplateDayPlan): ChemotherapyMedication[] {
  const storedItems = plan.medicationItems ?? []
  if (storedItems.length) {
    return storedItems.map((item) => ({
      ...item,
      name: item.name ?? '',
    }))
  }
  return legacyMedicationItems(plan.id, plan.medications, plan.dosage)
}

export function summarizeChemotherapyMedications(items: ChemotherapyMedication[]) {
  const validItems = items.filter((item) => item.name.trim())
  return {
    medications: validItems.map((item) => item.name.trim()).join(' + '),
    dosage: validItems.map((item) => {
      const doseValue = item.dose?.trim()
      const unit = item.unit?.trim()
      const dose = unit === 'AUC' && doseValue ? `AUC ${doseValue}` : [doseValue, unit].filter(Boolean).join(' ')
      const details = [dose, item.administration?.trim(), item.notes?.trim()].filter(Boolean).join(' · ')
      return details ? `${item.name.trim()}：${details}` : ''
    }).filter(Boolean).join('\n'),
  }
}

export function getChemotherapyTemplateDayPlans(template: ChemotherapyTemplate): ChemotherapyTemplateDayPlan[] {
  const storedPlans = template.dayPlans ?? []
  if (storedPlans.length) {
    const seen = new Set<number>()
    return storedPlans
      .filter((plan) => {
        if (!Number.isInteger(plan.day) || plan.day < 1 || plan.day > template.cycleLengthDays || seen.has(plan.day)) return false
        seen.add(plan.day)
        return true
      })
      .map((plan) => ({
        ...plan,
        medicationItems: getChemotherapyDayMedications(plan),
      }))
      .sort((first, second) => first.day - second.day)
  }
  return normalizeAdministrationDays(template.administrationDays, template.cycleLengthDays).map((day) => ({
    id: `legacy-${template.id}-${day}`,
    day,
    medicationItems: legacyMedicationItems(`legacy-${template.id}-${day}`, template.medications, template.dosage),
    medications: template.medications,
    dosage: template.dosage,
  }))
}

const eventTypeByPlanType: Record<TreatmentPlanType, EventType> = {
  chemotherapy: 'chemotherapy',
  radiotherapy: 'radiotherapy',
  maintenance: 'maintenance',
  targeted: 'targeted',
  immunotherapy: 'immunotherapy',
  supportive: 'medication',
  other: 'other',
}

export function buildTreatmentCourseEvents(template: ChemotherapyTemplate, options: CourseGenerationOptions): TreatmentEvent[] {
  const now = options.now ?? new Date().toISOString()
  const courseId = newId()
  const firstCycleNumber = options.firstCycleNumber ?? 1
  const cycleCount = Math.max(1, Math.floor(options.cycleCount))
  const dayPlans = getChemotherapyTemplateDayPlans(template)
  const planType = template.templateType ?? 'chemotherapy'
  const eventType = eventTypeByPlanType[planType]
  const planTypeLabel = TREATMENT_PLAN_TYPES[planType].label
  const events: TreatmentEvent[] = []

  for (let cycleIndex = 0; cycleIndex < cycleCount; cycleIndex += 1) {
    const cycleNumber = firstCycleNumber + cycleIndex
    const cycleDayOne = shiftDate(options.firstDayOne, cycleIndex * template.cycleLengthDays)
    const cycleId = newId()
    for (const dayPlan of dayPlans) {
      const administrationDay = dayPlan.day
      const eventDate = shiftDate(cycleDayOne, administrationDay - 1)
      const medicationSummary = summarizeChemotherapyMedications(getChemotherapyDayMedications(dayPlan))
      const medicationItems = TREATMENT_PLAN_TYPES[planType].usesMedication
        ? getChemotherapyDayMedications(dayPlan).map((item) => ({ ...item, id: newId() }))
        : undefined
      events.push({
        id: newId(),
        type: eventType,
        title: `第 ${cycleNumber} ${planType === 'radiotherapy' ? '疗程' : '周期'} D${administrationDay} ${planTypeLabel}`,
        startDate: eventDate,
        endDate: eventDate,
        plannedStartDate: eventDate,
        allDay: true,
        hospital: template.hospital,
        department: template.department,
        regimen: template.regimen || template.name,
        medications: medicationItems?.length ? medicationSummary.medications || undefined : undefined,
        dosage: medicationItems?.length ? medicationSummary.dosage || undefined : undefined,
        medicationItems,
        radiotherapySite: planType === 'radiotherapy' ? dayPlan.radiotherapySite : undefined,
        radiotherapyDoseGy: planType === 'radiotherapy' ? dayPlan.radiotherapyDoseGy : undefined,
        cycleNumber,
        cycleDayOne,
        chemotherapyTemplateId: template.id,
        chemotherapyCourseId: courseId,
        chemotherapyCycleId: cycleId,
        administrationDay,
        notes: [template.notes?.trim(), dayPlan.notes?.trim()].filter(Boolean).join('\n') || undefined,
        tags: [],
        linkedRecordIds: [],
        createdAt: now,
        updatedAt: now,
      })
    }
  }
  return events
}

/** Kept for existing callers and migrated data; new UI uses the plan-type-aware builder above. */
export const buildChemotherapyCourseEvents = buildTreatmentCourseEvents

export function groupChemotherapyCycles(events: TreatmentEvent[]): ChemotherapyCycle[] {
  const groups = new Map<string, TreatmentEvent[]>()
  events
    .filter((event) => event.type === 'chemotherapy')
    .forEach((event) => {
      const key = event.chemotherapyCycleId || event.id
      groups.set(key, [...(groups.get(key) ?? []), event])
    })

  return [...groups.entries()]
    .map(([id, cycleEvents]) => {
      const sorted = [...cycleEvents].sort((first, second) => first.startDate.localeCompare(second.startDate))
      const dayOneEvent = sorted.find((event) => event.administrationDay === 1)
      const representative = dayOneEvent ?? sorted[0]
      return {
        id,
        dayOne: dayOneEvent?.startDate || representative.cycleDayOne || representative.startDate,
        cycleNumber: representative.cycleNumber,
        title: representative.cycleNumber ? `第 ${representative.cycleNumber} 周期` : representative.title,
        events: sorted,
      }
    })
    .sort((first, second) => first.dayOne.localeCompare(second.dayOne))
}

export function rescheduleChemotherapyEvents(
  allEvents: TreatmentEvent[],
  original: TreatmentEvent,
  updatedTarget: TreatmentEvent,
  scope: ChemotherapyRescheduleScope,
) {
  const delta = differenceInCalendarDays(parseISO(updatedTarget.startDate), parseISO(original.startDate))
  if (!delta || !original.chemotherapyCourseId || !original.chemotherapyCycleId) return [updatedTarget]

  const courseEvents = allEvents.filter((event) => event.chemotherapyCourseId === original.chemotherapyCourseId)
  const affectedIds = new Set(courseEvents.filter((event) => {
    if (event.id === original.id) return true
    if (scope === 'single') return false
    if (event.startDate < original.startDate) return false
    return scope === 'cycle'
      ? event.chemotherapyCycleId === original.chemotherapyCycleId
      : true
  }).map((event) => event.id))

  const nextCourseEvents = courseEvents.map((event) => {
    if (event.id === original.id) return updatedTarget
    if (!affectedIds.has(event.id)) return event
    return {
      ...event,
      startDate: shiftDate(event.startDate, delta),
      endDate: shiftDate(event.endDate, delta),
      updatedAt: updatedTarget.updatedAt,
    }
  })

  const dayOneByCycle = new Map<string, string>()
  nextCourseEvents.forEach((event) => {
    if (event.chemotherapyCycleId && event.administrationDay === 1) {
      dayOneByCycle.set(event.chemotherapyCycleId, event.startDate)
    }
  })

  return nextCourseEvents
    .map((event) => {
      const cycleDayOne = event.chemotherapyCycleId ? dayOneByCycle.get(event.chemotherapyCycleId) : undefined
      if (!cycleDayOne || cycleDayOne === event.cycleDayOne) return event
      return { ...event, cycleDayOne, updatedAt: updatedTarget.updatedAt }
    })
    .filter((event) => {
      const previous = courseEvents.find((item) => item.id === event.id)
      return previous && JSON.stringify(previous) !== JSON.stringify(event)
    })
}
