import React, { useMemo, useState, useEffect } from "react";
import { 
	useTable, 
	useFilters, 
	useSortBy, 
	useGlobalFilter, 
	useAsyncDebounce,
	usePagination,
	useBlockLayout,
	useResizeColumns
} from "react-table";
import { resolve, resolve_references } from '@/_helpers/utils';
import Skeleton from 'react-loading-skeleton';

export function Table({ id, width, height, component, onComponentClick, currentState = { components: { } }, onEvent, paramUpdated, changeCanDrag, onComponentOptionChanged }) {

	const color = component.definition.styles.textColor.value;
	const actions = component.definition.properties.actions || { value: []};

	const [loadingState, setLoadingState] = useState(false);

    useEffect(() => {

		const loadingStateProperty = component.definition.properties.loadingState;
		if(loadingStateProperty && currentState) { 
			const newState = resolve_references(loadingStateProperty.value, currentState, false);
			setLoadingState(newState);
		}

    }, [currentState]);

	const [componentState, setcomponentState] = useState(currentState.components[component.component] || {});

	useEffect(() => {
		setcomponentState(currentState.components[component.name] || {})

    }, [currentState.components[component.name]]);

    const [filterInput, setFilterInput] = useState("");

	const handleFilterChange = e => {
		const value = e.target.value || undefined;
		setFilter("name", value); 
		setFilterInput(value);
	};

	const defaultColumn = React.useMemo(
		() => ({
		  minWidth: 30,
		  width: 268,
		  maxWidth: 400,
		}),
		[]
	)

	const columnSizes = component.definition.properties.columnSizes || {};

	function handleCellValueChange(index, name, value, rowData) {
		const changeSet = componentState.changeSet;
		const dataUpdates = componentState.dataUpdates || [];

		let newChangeset = {
			...changeSet,
			[index]: {
				...changeSet ? changeSet[index] : {},
				[name]: value
			}
		}

		let newDataUpdates = [
			...dataUpdates,
			{ ...rowData, [name]: value }
		]
		onComponentOptionChanged(component, 'changeSet', newChangeset);
		onComponentOptionChanged(component, 'dataUpdates', newDataUpdates);
	}

	function handleChangesSaved() {
		// Handle events after changes are saved
	}

	const changeSet = componentState ? componentState.changeSet : {};

	const columnData = component.definition.properties.columns.value.map((column) => { 
		const columnSize = columnSizes[column.key] || columnSizes[column.name];
		const columnType = column.columnType;
		
    	return { Header: 
			column.name, 
			accessor: column.key || column.name, 
			width: columnSize ? columnSize : defaultColumn.width,

			Cell: function (cell) {
				const rowChangeSet = changeSet ? changeSet[cell.row.index] : null;
				const cellValue = rowChangeSet ? rowChangeSet[column.name] || cell.value : cell.value;

				if(columnType === undefined || columnType === 'default') {
					return cellValue;
				} else if(columnType === 'string') {
					if(column.isEditable) {
						return <input 
							type="text" 
							onKeyDown={(e) => { if(e.key === "Enter") { handleCellValueChange(cell.row.index, column.name, e.target.value, cell.row.original) }}}
							onBlur={ (e) => { handleCellValueChange(cell.row.index, column.name, e.target.value, cell.row.original) } }
							className="form-control-plaintext form-control-plaintext-sm" 
							defaultValue={cellValue} 
						/>;
					} else {
						return cellValue;
					}
				} else {
					return cellValue;
				}
			}
		} 
    })

    let tableData = []
    if(currentState) {
        tableData = resolve(component.definition.properties.data.value, currentState, []);
        console.log('resolved param', tableData);
    }

	tableData = tableData ? tableData : [];

	const actionsCellData = actions.value.length > 0 ? [{
		id: 'actions',
		Header: 'Actions',
		accessor: 'edit',
		width: columnSizes['actions'] ||  defaultColumn.width,
		Cell: (cell) => {
			return actions.value.map((action) => 
				<button 
					className="btn btn-sm m-1 btn-light"
					style={{background: action.backgroundColor, color: action.textColor}}
					onClick={(e) => { e.stopPropagation(); onEvent('onTableActionButtonClicked', { component, data: cell.row.original, action }); }}
				>
					{action.buttonText}
				</button>
			)
		}
	}] : [];

    const columns = useMemo(
		() =>
			[
				...columnData,
				...actionsCellData
			],
		[columnData.length, actionsCellData.length, componentState.changeSet]
    );

	const data = useMemo(
		() =>
		tableData,
		[tableData.length]
	);

	const computedStyles = { 
        color,
		width: `${width}px`,
    }

    const {
        getTableProps,
        getTableBodyProps,
        headerGroups,
		page,
		canPreviousPage,
		canNextPage,
		pageOptions,
		gotoPage,
		pageCount,
		nextPage,
		previousPage,
		setPageSize,
		state,
        prepareRow,
		setFilter,
		preGlobalFilteredRows,
    	setGlobalFilter,
		state: { pageIndex, pageSize }
    } = useTable( {
        columns,
        data,
		defaultColumn,
		initialState: { pageIndex: 0 },
    },
	useFilters,
	useGlobalFilter,
	useSortBy,
	usePagination,
	useBlockLayout,
	useResizeColumns
	);
	
	useEffect(() => {
		if(!state.columnResizing.isResizingColumn) {
			changeCanDrag(true);
			paramUpdated(id, 'columnSizes', state.columnResizing.columnWidths);
		} else {
			changeCanDrag(false);
		}
	}, [state.columnResizing]);

	function GlobalFilter({
		preGlobalFilteredRows,
		globalFilter,
		setGlobalFilter,
	  }) {
		const count = preGlobalFilteredRows.length
		const [value, setValue] = React.useState(globalFilter)
		const onChange = useAsyncDebounce(value => {
		  setGlobalFilter(value || undefined)
		}, 200)
	  
		return (
		  <div className="ms-2 d-inline-block">
			Search:{' '}
			<input
			  value={value || ""}
			  onChange={e => {
				setValue(e.target.value);
				onChange(e.target.value);
			  }}
			  placeholder={`${count} records`}
			  style={{
				border: '0',
			  }}
			/>
		  </div>
		)
	}

    return (
		<div className="card" style={{width: `${width + 16}px`, height: `${height+3}px`}} onClick={() => onComponentClick(id, component) }>
		<div className="card-body border-bottom py-3 jet-data-table-header">
		  <div className="d-flex">
			<div className="text-muted">
			  Show
			  <div className="mx-2 d-inline-block">
				<select
					value={pageSize}
					className="form-control form-control-sm"
					onChange={e => {
						setPageSize(Number(e.target.value))
					}}
					>
					{[10, 20, 30, 40, 50].map(pageSize => (
						<option key={pageSize} value={pageSize}>
							{pageSize}
						</option>
					))}
				</select>
			  </div>
			  entries
			</div>
			<div className="ms-auto text-muted">
			  
				{/* <input
					className="form-control form-control-sm"
					value={filterInput}
					onChange={handleFilterChange}
					placeholder={"Search name"}
				/> */}
				<GlobalFilter
					preGlobalFilteredRows={preGlobalFilteredRows}
					globalFilter={state.globalFilter}
					setGlobalFilter={setGlobalFilter}
				/>
			</div>
		  </div>
		</div>
		<div className="table-responsive jet-data-table">
		<table {...getTableProps()} className="table table-vcenter table-nowrap table-bordered" style={computedStyles}>
			<thead>
				{headerGroups.map(headerGroup => (
				<tr {...headerGroup.getHeaderGroupProps()} tabIndex="0" className="tr">
					{headerGroup.headers.map(column => (
					<th className="th"
						{...column.getHeaderProps(column.getSortByToggleProps())}
						className={
							column.isSorted
							  ? column.isSortedDesc
								? "sort-desc th"
								: "sort-asc th"
							  : "th"
						}
					>
						{column.render("Header")}
						<div draggable="true"
							{...column.getResizerProps()}
							className={`resizer ${
								column.isResizing ? 'isResizing' : ''
							}`}
						/>
					</th>
					))}
				</tr>
				))}
			</thead>
			{!loadingState && 
				<tbody {...getTableBodyProps()}>
					{console.log('page', page)}
					{page.map((row, i) => {
					prepareRow(row);
					return (
						<tr className="table-row" {...row.getRowProps()} onClick={(e) => { e.stopPropagation(); onEvent('onRowClicked',  { component, data: row.original }); }}>
						{row.cells.map(cell => {
							
							let cellProps = cell.getCellProps();

							if(componentState.changeSet) {
								if(componentState.changeSet[cell.row.index]) {
									if(componentState.changeSet[cell.row.index][cell.column.Header]) {
										cellProps['style']['backgroundColor'] =  '#ffffde';
									}
								}
							}
							return <td {...cellProps}>{cell.render("Cell")}</td>;
						})}
						</tr>
					);
					})}
				</tbody>
			}
			</table>
			{loadingState && 
                <div style={{width: '100%'}} className="p-2">
                    <Skeleton count={5}/> 
                </div>
            }
		</div>
		<div className="card-footer d-flex align-items-center jet-table-footer">
			<div className="pagination row">
				<div className="pagination-buttons col">
					<button className="btn btn-sm btn-light" onClick={() => gotoPage(0)} disabled={!canPreviousPage}>
					{'<<'}
					</button>{' '}
					<button className="btn btn-light btn-sm" onClick={() => previousPage()} disabled={!canPreviousPage}>
					{'<'}
					</button>{' '}
					<button className="btn btn-light btn-sm"  onClick={() => nextPage()} disabled={!canNextPage}>
					{'>'}
					</button>{' '}
					<button className="btn btn-light btn-sm mr-5"  onClick={() => gotoPage(pageCount - 1)} disabled={!canNextPage}>
					{'>>'}
					</button>{' '}
				</div>

				{componentState.changeSet && 
					<div className="col">
						<button 
							className={`btn btn-primary btn-sm ${componentState.isSavingChanges ? 'btn-loading' : ''}`}
							onClick={(e) => onEvent('onBulkUpdate',  { component } ).then(() => {
								handleChangesSaved();
							})}
						>
							Save Changes
						</button>
						<button className="btn btn-light btn-sm mx-2">Cancel</button>
					</div>
				}

				<div className="page-stats col-auto">
					<span className="p-1">
						Page{' '}
						<strong>
							{pageIndex + 1} of {pageOptions.length}
						</strong>{' '}
						</span>
				</div>
				
				<div className="goto-page col-auto">
					<div className="row">
						<div className="col">
							| Go to page:{' '}
						</div>
						<div className="col-auto">
						<input
							type="number"
							className="form-control form-control-sm"
							defaultValue={pageIndex + 1}
							onChange={e => {
							const page = e.target.value ? Number(e.target.value) - 1 : 0
							gotoPage(page)
							}}
							style={{ width: '50px' }}
						/>
						</div>
					</div>
				</div>
			</div>
		</div>
	  </div>
      );


}
