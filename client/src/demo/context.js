import { createContext, useContext } from 'react'

export const DemoContext = createContext(null)
export function useDemo() { return useContext(DemoContext) }
