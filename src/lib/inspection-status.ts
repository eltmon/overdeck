export interface InspectionStatusFields {
  inspectStatus?: 'pending' | 'inspecting' | 'passed' | 'failed' | 'error';
  inspectNotes?: string;
  inspectStartedAt?: string;
  inspectBeadId?: string;
  inspectOwnerSession?: string;
}
