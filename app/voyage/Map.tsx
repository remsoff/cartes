'use client'
import {
	CityImage,
	Destination,
	ImageWithNameWrapper,
} from '@/components/conversation/VoyageUI'
import css from '@/components/css/convertToJs'
import Emoji, { findOpenmoji } from '@/components/Emoji'
import destinationPoint from '@/public/destination-point.svg'
import getCityData, { toThumb } from 'Components/wikidata'
import { motion } from 'framer-motion'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import styled from 'styled-components'
import { createPolygon, createSearchBBox } from './createSearchPolygon'
import { sortGares } from './gares'
import categories from './categories.yaml'

const ModalSheet = dynamic(() => import('./ModalSheet'), {
	ssr: false,
})
import PlaceSearch from './PlaceSearch'
import QuickFeatureSearch from './QuickFeatureSearch'
import { osmRequest } from './osmRequest'
import { centerOfMass } from '@turf/turf'

const defaultCenter =
	// Saint Malo [-1.9890417068124002, 48.66284934737089]
	[-1.6776317608896583, 48.10983044383964]

const defaultState = {
	depuis: { inputValue: '', choice: false },
	vers: { inputValue: '', choice: false },
	validated: false,
}
export default function Map({ searchParams }) {
	const [state, setState] = useState(defaultState)
	const [isSheetOpen, setSheetOpen] = useState(false)
	const [wikidata, setWikidata] = useState(null)
	const [osmFeature, setOsmFeature] = useState(null)

	const [latLngClicked, setLatLngClicked] = useState(null)

	const categoryName = searchParams.cat,
		category = categoryName && categories.find((c) => c.name === categoryName)

	const versImageURL = wikidata?.pic && toThumb(wikidata?.pic.value)
	useEffect(() => {
		if (!state.vers.choice) return undefined

		getCityData(state.vers.choice.item.ville).then((json) =>
			setWikidata(json?.results?.bindings[0])
		)
	}, [state.vers])

	const onInputChange = (whichInput) => (e) => {
		let v = e.target.value
		setState({
			...state,
			[whichInput]: { ...state[whichInput], inputValue: v },
			validated: false,
		})
		if (v.length > 2) {
			fetch(`https://photon.komoot.io/api/?q=${v}&limit=6&layer=city&lang=fr`)
				.then((res) => res.json())
				.then((json) => {
					setState((state) => ({
						...state,
						[whichInput]: {
							...state[whichInput],
							results: json.features.map((f) => ({
								item: {
									longitude: f.geometry.coordinates[0],
									latitude: f.geometry.coordinates[1],
									nom: f.properties.name,
									ville: f.properties.cities || f.properties.name,
									pays: f.properties.country,
								},
							})),
						},
					}))
				})
		}
	}

	if (process.env.NEXT_PUBLIC_MAPTILER == null) {
		throw new Error('You have to configure env REACT_APP_API_KEY, see README')
	}

	const mapContainerRef = useRef()

	const choice = state.vers?.choice
	const center = useMemo(
		() => choice && [choice.item.longitude, choice.item.latitude],
		[choice]
	)

	const [gares, setGares] = useState(null)
	const [map, setMap] = useState(null)
	const [clickedGare, clickGare] = useState(null)
	const [bikeRoute, setBikeRoute] = useState(null)
	const [features, setFeatures] = useState([])

	useEffect(() => {
		if (!map || !category) return

		const fetchCategories = async () => {
			const mapLibreBbox = map.getBounds().toArray(),
				bbox = [
					mapLibreBbox[0][1],
					mapLibreBbox[0][0],
					mapLibreBbox[1][1],
					mapLibreBbox[1][0],
				].join(',')

			const overpassRequest = `
[out:json];
(
  node${category.query}(${bbox});
  way${category.query}(${bbox});
);

out body;
>;
out skel qt;

`
			const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(
				overpassRequest
			)}`
			console.log(url)
			const request = await fetch(url)
			const json = await request.json()
			const namedElements = json.elements.filter((element) => {
				if (!element.tags || !element.tags.name) return false
				if (!['way', 'node'].includes(element.type)) return false
				return true
			})
			console.log({ namedElements })
			const nodeElements = namedElements.map((element) => {
				if (element.type === 'node') return element
				const nodes = element.nodes.map((id) =>
						json.elements.find((el) => el.id === id)
					),
					polygon = {
						type: 'Feature',
						geometry: {
							type: 'Polygon',
							coordinates: [nodes.map(({ lat, lon }) => [lat, lon])],
						},
					}
				console.log({ polygon })
				const center = centerOfMass(polygon)

				console.log('center', center)
				const [lat, lon] = center.geometry.coordinates
				console.log({ lon, lat })

				return { ...element, lat, lon }
			})

			setFeatures(nodeElements)
		}
		fetchCategories()
	}, [category, map])

	useEffect(() => {
		if (!map || features.length < 1) return

		const imageUrl = findOpenmoji(category.emoji, false, 'png')
		console.log({ imageUrl })
		map.loadImage(imageUrl, (error, image) => {
			if (error) throw error
			map.addImage(category.name, image)

			map.addSource('features', {
				type: 'geojson',
				data: {
					type: 'FeatureCollection',
					features: features.map((f) => ({
						type: 'Feature',
						geometry: {
							type: 'Point',
							coordinates: [f.lon, f.lat],
						},
						properties: { id: f.id, tags: f.tags, name: f.tags.name },
					})),
				},
			})

			// Add a symbol layer
			map.addLayer({
				id: 'features',
				type: 'symbol',
				source: 'features',
				layout: {
					'icon-image': category.name,
					'icon-size': 0.25,
					'text-field': ['get', 'name'],
					'text-offset': [0, 1.25],
					'text-anchor': 'top',
				},
			})
		})

		return () => {
			map.removeLayer('features')
			map.removeSource('features')
		}
	}, [features, map])

	useEffect(() => {
		if (!center || !clickedGare) return

		const [lon1, lat1] = clickedGare.coordonnées,
			[lon2, lat2] = center

		async function fetchBikeRoute() {
			const url = `https://brouter.osc-fr1.scalingo.io/brouter?lonlats=${lon1},${lat1}|${lon2},${lat2}&profile=safety&alternativeidx=0&format=geojson`
			const res = await fetch(url)
			const json = await res.json()
			setBikeRoute(json)
		}

		fetchBikeRoute()
	}, [center, clickedGare])
	useEffect(() => {
		async function fetchGares() {
			const res = await fetch('/gares.json')
			const json = await res.json()
			setGares(json)
		}
		fetchGares()
	}, [setGares])

	useEffect(() => {
		const newMap = new maplibregl.Map({
			container: mapContainerRef.current,
			style: `https://api.maptiler.com/maps/2f80a9c4-e0dd-437d-ae35-2b6c212f830b/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER}`,
			center: defaultCenter,
			zoom: 8,
			hash: true,
		})
		setMap(newMap)

		newMap.addControl(new maplibregl.NavigationControl(), 'top-right')
		newMap.addControl(
			new maplibregl.GeolocateControl({
				positionOptions: {
					enableHighAccuracy: true,
				},
				trackUserLocation: true,
			})
		)

		//new maplibregl.Marker({ color: '#FF0000' }).setLngLat(defaultCenter).addTo(newMap)

		return () => {
			newMap.remove()
		}
	}, [setMap])

	useEffect(() => {
		if (!map || !bikeRoute || !bikeRoute.features) return

		map.addSource('bikeRoute', {
			type: 'geojson',
			data: bikeRoute.features[0],
		})
		map.addLayer({
			id: 'bikeRoute',
			type: 'line',
			source: 'bikeRoute',
			layout: {
				'line-join': 'round',
				'line-cap': 'round',
			},
			paint: {
				'line-color': '#5B099F',
				'line-width': 8,
			},
		})

		return () => {
			map.removeLayer('bikeRoute')
			map.removeSource('bikeRoute')
		}
	}, [bikeRoute, map])

	useEffect(() => {
		if (!map) return
		map.on('click', async (e) => {
			console.log('click event', e)
			setLatLngClicked(e.lngLat)
			setSheetOpen(true)

			const source = map.getSource('searchPolygon')
			const polygon = createPolygon(createSearchBBox(e.lngLat))

			if (source) {
				source.setData(polygon.data)
				map.setPaintProperty('searchPolygon', 'fill-opacity', 0.6)
			} else {
				map.addSource('searchPolygon', polygon)

				map.addLayer({
					id: 'searchPolygon',
					type: 'fill',
					source: 'searchPolygon',
					layout: {},
					paint: {
						'fill-color': '#57bff5',
						'fill-opacity': 0.6,
					},
				})
			}
			setTimeout(
				() => map.setPaintProperty('searchPolygon', 'fill-opacity', 0),
				1000
			)

			// Thanks OSMAPP https://github.com/openmaptiles/openmaptiles/issues/792
			const features = map.queryRenderedFeatures(e.point)

			if (!features.length || !features[0].id) return

			const openMapTilesId = '' + features[0].id

			console.log('renderedFeatures', features)
			const id = openMapTilesId.slice(null, -1),
				featureType = { '1': 'way', '0': 'node', '4': 'relation' }[
					openMapTilesId.slice(-1)
				]
			if (!featureType) {
				console.log('Unknown OSM feature type from OpenMapTiles ID')
				return
			}
			console.log(features, id, openMapTilesId)

			const elements = await osmRequest(featureType, id)

			console.log('Résultat OSM', elements)
			if (!elements.length) return

			setOsmFeature(elements[0])
		})
	}, [map])

	useEffect(() => {
		if (!map) return

		map.on('click', 'features', async (e) => {
			const properties = e.features[0].properties,
				tagsRaw = properties.tags
			const tags = typeof tagsRaw === 'string' ? JSON.parse(tagsRaw) : tagsRaw

			setOsmFeature({ ...properties, tags })
		})
		map.on('mouseenter', 'features', () => {
			map.getCanvas().style.cursor = 'pointer'
		})
		// Change it back to a pointer when it leaves.
		map.on('mouseleave', 'features', () => {
			map.getCanvas().style.cursor = ''
		})
	}, [map])

	useEffect(() => {
		if (!map || !center) return
		map.flyTo({
			center,
			zoom: 10,
			pitch: 50, // pitch in degrees
			bearing: 20, // bearing in degrees
		})
		new maplibregl.Marker({ color: 'var(--darkerColor)' })
			.setLngLat(center)
			.addTo(map)
	}, [center, map])

	const lesGaresProches =
		center && gares && sortGares(gares, center).slice(0, 30)

	useEffect(() => {
		if (!lesGaresProches) return
		lesGaresProches.map((gare) => {
			const el = document.createElement('div')
			const root = createRoot(el)
			const size = { 1: '25px', 2: '35px', 3: '45px' }[gare.niveau] || '15px'
			flushSync(() => {
				root.render(
					<div
						style={css`
							display: flex;
							flex-direction: column;
							align-items: center;
							cursor: help;
						`}
					>
						<img
							src="/gare.svg"
							style={{ width: size, height: size }}
							alt="Icône d'une gare"
						/>
					</div>
				)
			})

			el.addEventListener('click', () => {
				clickGare(gare.uic === clickedGare?.uic ? null : gare)
				setSheetOpen(true)
			})

			new maplibregl.Marker({ element: el })
				.setLngLat(gare.coordonnées)
				.addTo(map)
		})
	}, [lesGaresProches, map])

	return (
		<div
			css={`
				position: absolute;
				top: 0;
				left: 0;
				width: 100%;
				height: 100%;
				background: #faf5e4;
				> div:last-child {
					position: absolute;
					width: 100%;
					height: 100%;
				}
				> a {
					position: absolute;
					left: 10px;
					bottom: 10px;
					z-index: 999;
				}
				color: var(--darkestColor);
			`}
		>
			<div
				css={`
					position: absolute;
					top: 2vh;
					left: 4vw;
					z-index: 10;
					h1 {
						color: var(--darkerColor);
						border-bottom: 5px solid var(--color);
						display: inline-block;
						padding: 0;
						line-height: 1.8rem;
						margin-top: 1rem;
						@media (max-width: 800px) {
							margin: 0;
							margin-bottom: 0.4rem;
							font-size: 120%;
							border-bottom-width: 2px;
							line-height: 1.2rem;
						}
					}
				`}
			>
				<div
					css={`
						display: flex;
						align-items: center;
					`}
				>
					<h1>Où allez-vous ?</h1>

					{choice && (
						<button
							onClick={() => setState(defaultState)}
							css={`
								background: white;
								border: 3px solid var(--color);
								width: 2.5rem;
								height: 2.5rem;
								border-radius: 3rem;
								display: inline-flex;
								margin: 0 0.6rem;
								align-items: center;
								justify-content: center;
							`}
						>
							<Emoji e="✏️" />
						</button>
					)}
				</div>
				{!choice && <PlaceSearch {...{ onInputChange, state, setState }} />}
				{choice && versImageURL && (
					<motion.div
						initial={{ opacity: 0, scale: 0.8 }}
						animate={{ opacity: 1, scale: 1 }}
						transition={{}}
						key={versImageURL}
						exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.2 } }}
					>
						<ImageWithNameWrapper>
							<CityImage
								src={versImageURL}
								alt={`Une photo emblématique de la destination, ${state.vers.choice?.item?.nom}`}
							/>
							<Destination>
								<Image src={destinationPoint} alt="Vers" />
								<h2>{state.vers.choice.item.nom}</h2>
							</Destination>
						</ImageWithNameWrapper>
					</motion.div>
				)}
				<QuickFeatureSearch category={category} />

				{/* 


Alternatives : https://github.com/helgastogova/react-stateful-bottom-sheet?ref=hackernoon.com
https://github.com/helgastogova/react-stateful-bottom-sheet?ref=hackernoon.com
bof

mieux : https://github.com/plrs9816/slick-bottom-sheet/

https://codesandbox.io/s/framer-motion-bottom-sheet-for-desktop-with-drag-handle-ov8e0o

https://swipable-modal.vercel.app



			*/}
				<ModalSheet
					{...{
						isSheetOpen,
						setSheetOpen,
						clickedGare,
						bikeRoute,
						osmFeature,
						latLngClicked,
					}}
				/>
			</div>
			<div ref={mapContainerRef} />
		</div>
	)
}
