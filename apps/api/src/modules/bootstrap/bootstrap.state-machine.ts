import { Injectable } from '@nestjs/common';

type BootstrapState =
  | 'CREATED'
  | 'DISCOVERING'
  | 'PARSING'
  | 'VALIDATING'
  | 'NORMALIZING'
  | 'COMPILING'
  | 'PUBLISHED'
  | 'FAILED';

type BootstrapEvent =
  | 'START_DISCOVERY'
  | 'DISCOVERY_COMPLETE'
  | 'START_PARSING'
  | 'PARSING_COMPLETE'
  | 'START_VALIDATING'
  | 'VALIDATING_COMPLETE'
  | 'START_NORMALIZING'
  | 'NORMALIZING_COMPLETE'
  | 'START_COMPILING'
  | 'COMPILING_COMPLETE'
  | 'FAIL';

@Injectable()
export class BootstrapStateMachine {
  private transitions: Record<BootstrapState, Partial<Record<BootstrapEvent, BootstrapState>>> = {
    CREATED: {
      START_DISCOVERY: 'DISCOVERING',
      FAIL: 'FAILED',
    },
    DISCOVERING: {
      DISCOVERY_COMPLETE: 'PARSING',
      FAIL: 'FAILED',
    },
    PARSING: {
      PARSING_COMPLETE: 'VALIDATING',
      FAIL: 'FAILED',
    },
    VALIDATING: {
      VALIDATING_COMPLETE: 'NORMALIZING',
      FAIL: 'FAILED',
    },
    NORMALIZING: {
      NORMALIZING_COMPLETE: 'COMPILING',
      FAIL: 'FAILED',
    },
    COMPILING: {
      COMPILING_COMPLETE: 'PUBLISHED',
      FAIL: 'FAILED',
    },
    PUBLISHED: {},
    FAILED: {},
  };

  transition(currentState: string, event: string): BootstrapState {
    const state = currentState as BootstrapState;
    const evt = event as BootstrapEvent;

    const nextState = this.transitions[state]?.[evt];
    if (!nextState) {
      throw new Error(`Invalid transition: ${state} -> ${event}`);
    }

    return nextState;
  }

  canTransition(currentState: string, event: string): boolean {
    const state = currentState as BootstrapState;
    const evt = event as BootstrapEvent;
    return !!this.transitions[state]?.[evt];
  }

  getAvailableEvents(currentState: string): BootstrapEvent[] {
    const state = currentState as BootstrapState;
    return Object.keys(this.transitions[state] || {}) as BootstrapEvent[];
  }
}
