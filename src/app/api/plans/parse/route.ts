import { NextRequest, NextResponse } from 'next/server'
import { parseMarkdownTable } from '@/lib/markdown-parser'

export async function POST(request: NextRequest) {
  const { markdown } = await request.json()

  const result = parseMarkdownTable(markdown)

  return NextResponse.json(result)
}
