import type { MetadataRoute } from 'next'
import { getAllPostIds } from '@/app/blog/getPosts'
import { getRecentInterestingNodes } from '@/components/watchOsmPlaces.ts'
import { gtfsServerUrl } from './serverUrls'

const domain = 'https://cartes.app'

const basePaths = [
	'',
	'/blog',
	'/elections-legislatives-2024',
	'/presentation',
	'/presentation/state-of-the-map-2024',
	'/itineraire',
	'/transport-en-commun',
]

const generateAgencies = async () => {
	try {
		const request = await fetch(gtfsServerUrl + '/agencies')
		const json = await request.json()

		return json.agencies.map(
			({ agency_id }) => `/?transports=oui&agence=${agency_id}`
		)
	} catch (e) {
		console.error('Error generating agency sitemap')
		console.error(e)
	}
}

export default async function sitemap(): MetadataRoute.Sitemap {
	const newNodes = await getRecentInterestingNodes()

	const blogEntries = getAllPostIds().map(({ params: { id } }) => '/blog/' + id)
	const agencies = await generateAgencies()
	const entries = [...basePaths, ...blogEntries, ...agencies, ...newNodes].map(
		(path) => ({
			url: escapeXml(domain + path),
		})
	)
	console.log('Sitemap', entries)
	return entries
}

function escapeXml(unsafe) {
	return unsafe.replace(/[<>&'"]/g, function (c) {
		switch (c) {
			case '<':
				return '&lt;'
			case '>':
				return '&gt;'
			case '&':
				return '&amp;'
			case "'":
				return '&apos;'
			case '"':
				return '&quot;'
		}
	})
}
