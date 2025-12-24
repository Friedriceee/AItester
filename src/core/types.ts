export type EventType = 'click' | 'input' | 'navigation';

export interface ClickEvent {
  type: 'click';
  selector: string;
  x?: number;
  y?: number;
  ts?: number;
}

export interface InputEvent {
  type: 'input';
  selector: string;
  value: string;
  ts?: number;
}

export interface NavEvent {
  type: 'navigation';
  url: string;
  ts?: number;
}

export type AIEvent = ClickEvent | InputEvent | NavEvent;

export interface AIR {
  version: string;
  meta: {
    url: string;
    startedAt: number;
    finishedAt?: number;
  };
  steps: AIEvent[];
}

export interface SmartTestCase {
  stepNumber: number;
  description: string;
  preconditions: string;
  expectedResult: string;
}

export interface DeepSeekResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}