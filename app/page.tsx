import AccountTable from './(components)/AccountTable'

export default function Page() {
  return (
    <main className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Solana Indexed Accounts</h1>
      <AccountTable 
        limit={100}
        orderBy="updated_at"
        orderDirection="desc"
      />
    </main>
  )
}
